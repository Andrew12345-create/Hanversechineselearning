#!/usr/bin/env node
// Static audit of the public site: undefined CSS tokens, duplicate ids,
// broken internal links, duplicate inline function declarations, images
// without alt text and pages missing core head tags.
//
// Usage: node scripts/audit-site.mjs [--json]
// Exit code 1 when anything is found, so it can gate a release.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const asJson = process.argv.includes('--json');

const pages = readdirSync(root).filter(f => f.endsWith('.html'));
const cssFiles = ['hanverse.css', 'legal.css', 'marketing/brand.css'].filter(f => existsSync(join(root, f)));

const defined = new Set();
for (const file of cssFiles) {
  const css = readFileSync(join(root, file), 'utf8');
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]);
}

const findings = [];
// Kinds that are known debt rather than release blockers. They are still
// reported, but they do not fail the gate: inline handlers need the CSP
// migration, and a few utility pages have no <main> landmark yet.
const WARN = new Set(['inline-handler', 'no-main-landmark', 'no-skip-link']);
const add = (page, kind, detail) => findings.push({ page, kind, detail, severity: WARN.has(kind) ? 'warn' : 'error' });

// Tokens referenced by the shared stylesheets must exist in :root, and a
// token must be defined once so later blocks cannot silently win.
for (const file of cssFiles) {
  const css = readFileSync(join(root, file), 'utf8');
  const localDefs = new Set(defined);
  const counts = new Map();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    localDefs.add(m[1]);
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    if (!localDefs.has(m[1])) add(file, 'undefined-token', m[1]);
  }
  for (const [token, n] of counts) {
    if (n > 1) add(file, 'duplicate-token', `${token} x${n}`);
  }
}

for (const page of pages) {
  const html = readFileSync(join(root, page), 'utf8');

  // Inline <style> blocks may define their own tokens.
  const local = new Set(defined);
  for (const block of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:/gi)) local.add(m[1]);
  }
  // Tokens are also set from script (style="--x:…" or a template literal),
  // so treat any "--x:" in the page as a definition.
  for (const m of html.matchAll(/(--[a-z0-9-]+)\s*:/gi)) local.add(m[1]);
  const used = new Set();
  for (const m of html.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) used.add(m[1]);
  for (const token of used) {
    if (!local.has(token)) add(page, 'undefined-token', token);
  }

  // Duplicate ids break aria references and getElementById.
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) add(page, 'duplicate-id', id);
    seen.add(id);
  }

  // Internal links must resolve to a real file.
  for (const m of html.matchAll(/href="([^"#?][^"]*)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(href)) continue;
    if (href.includes('${')) continue; // built at runtime
    const path = href.split('#')[0].split('?')[0];
    if (!path || path === '/') continue;
    const target = path.startsWith('/') ? join(root, path.slice(1)) : join(root, dirname(page), path);
    if (!existsSync(target)) add(page, 'broken-link', href);
  }

  // Duplicate function declarations inside one inline script silently
  // shadow each other; that has already caused two shipped bugs.
  for (const block of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const names = [...block[1].matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    for (const name of new Set(dupes)) add(page, 'duplicate-function', name);
  }

  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt=/.test(m[0])) add(page, 'img-no-alt', m[0].slice(0, 60));
  }

  // Production hygiene: leftover debug output, unfinished copy, and markup
  // that would block a stricter CSP or leak the opener window.
  for (const block of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const line of block[1].split('\n')) {
      // console.log behind a DEBUG guard is intentional and stays.
      if (/\bconsole\.(log|debug|info)\s*\(/.test(line) && !/\bDEBUG\b/.test(line)) {
        add(page, 'console-leftover', line.trim().slice(0, 60));
      }
    }
  }
  for (const m of html.matchAll(/\b(TODO|FIXME|XXX|HACK)\b/g)) add(page, 'unfinished-marker', m[1]);
  if (/lorem ipsum|placeholder text/i.test(html)) add(page, 'placeholder-copy', 'body copy');
  for (const m of html.matchAll(/<[^>]+\bon(?:click|change|submit|input|load|error)\s*=/gi)) {
    add(page, 'inline-handler', m[0].slice(0, 50));
  }
  for (const m of html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)) {
    if (!/rel=["'][^"']*noopener/.test(m[0])) add(page, 'blank-no-noopener', m[0].slice(0, 60));
  }
  for (const m of html.matchAll(/<a\b[^>]*href=["']#["']/gi)) add(page, 'dead-anchor', m[0].slice(0, 50));

  if (!/<main\b/i.test(html)) add(page, 'no-main-landmark', 'body');
  if (!/class=["'][^"']*skip/i.test(html) && !/href=["']#main/i.test(html)) add(page, 'no-skip-link', 'body');

  if (!/<html[^>]*\blang=/.test(html)) add(page, 'no-lang', 'html element');
  if (!/<meta[^>]+name="viewport"/i.test(html)) add(page, 'no-viewport', 'head');
  if (!/<title>[^<]+<\/title>/i.test(html)) add(page, 'no-title', 'head');
}

// Sitemap/robots correctness is owned by scripts/test-site-structure.mjs,
// which checks the per-host build output rather than the repo root.

const byKind = findings.reduce((acc, f) => {
  acc[f.kind] = (acc[f.kind] || 0) + 1;
  return acc;
}, {});
const errors = findings.filter(f => f.severity === 'error');
const warnings = findings.filter(f => f.severity === 'warn');

if (asJson) {
  console.log(JSON.stringify({ pages: pages.length, byKind, errors: errors.length, warnings: warnings.length, findings }, null, 2));
} else {
  for (const f of findings) console.log(`${f.severity}\t${f.page}\t${f.kind}\t${f.detail}`);
  console.log(`\n${pages.length} pages, ${errors.length} errors, ${warnings.length} warnings`);
  for (const [kind, n] of Object.entries(byKind)) console.log(`  ${kind}: ${n}`);
}

process.exit(errors.length ? 1 : 0);
