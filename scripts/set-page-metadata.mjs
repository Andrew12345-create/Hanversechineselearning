#!/usr/bin/env node
// Idempotently gives every page the metadata its host requires:
//   * exactly one absolute canonical pointing at the host that serves it
//   * noindex on signed-in shells, auth flows and error pages
//
// Run after adding a page: node scripts/set-page-metadata.mjs
// Pass --check to report drift without writing (used by the test suite).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  MARKETING_PAGES, APP_PAGES, SHARED_PAGES, NOINDEX_PAGES,
  MARKETING_HOST, APP_HOST
} from './site-map.mjs';

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');

const all = [...MARKETING_PAGES, ...APP_PAGES, ...SHARED_PAGES];
const canonicalFor = page => {
  if (SHARED_PAGES.includes(page)) return null;
  const host = MARKETING_PAGES.includes(page) ? MARKETING_HOST : APP_HOST;
  return page === 'index.html' ? `${host}/` : `${host}/${page}`;
};

let changed = 0;
const drift = [];

for (const page of all) {
  const file = join(root, page);
  if (!existsSync(file)) {
    drift.push(`${page}: missing`);
    continue;
  }
  const original = readFileSync(file, 'utf8');
  const nl = original.includes('\r\n') ? '\r\n' : '\n';
  let html = original.replace(/\r\n/g, '\n');

  const canonical = canonicalFor(page);
  const existing = [...html.matchAll(/[ \t]*<link\s+rel=["']canonical["'][^>]*>\n?/gi)];

  if (canonical) {
    const tag = `<link rel="canonical" href="${canonical}">`;
    if (existing.length === 0) {
      if (/<\/title>/i.test(html)) html = html.replace(/<\/title>\n?/i, m => `${m}${tag}\n`);
      else drift.push(`${page}: no <title> to anchor the canonical`);
    } else {
      // Keep the first, drop any duplicates, and correct the href.
      html = html.replace(/[ \t]*<link\s+rel=["']canonical["'][^>]*>\n?/gi, '');
      html = html.replace(/<\/title>\n?/i, m => `${m}${tag}\n`);
    }
  } else if (existing.length) {
    html = html.replace(/[ \t]*<link\s+rel=["']canonical["'][^>]*>\n?/gi, '');
  }

  const wantsNoindex = NOINDEX_PAGES.includes(page) || SHARED_PAGES.includes(page);
  const hasNoindex = /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html);
  if (wantsNoindex && !hasNoindex) {
    const tag = '<meta name="robots" content="noindex, nofollow">';
    if (/<\/title>/i.test(html)) html = html.replace(/<\/title>\n?/i, m => `${m}${tag}\n`);
    else drift.push(`${page}: no <title> to anchor the robots meta`);
  } else if (!wantsNoindex && hasNoindex) {
    drift.push(`${page}: unexpectedly noindex`);
  }

  const next = html.replace(/\n/g, nl);
  if (next !== original) {
    changed += 1;
    if (check) drift.push(`${page}: metadata out of date`);
    else writeFileSync(file, next);
  }
}

if (drift.length) {
  for (const line of drift) console.log(`  ${line}`);
  console.log(`\n${check ? '✗' : '!'} ${drift.length} page(s) need attention`);
  process.exit(check ? 1 : 0);
}
console.log(`✓ page metadata current (${all.length} pages${changed ? `, ${changed} rewritten` : ''})`);
