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
const add = (page, kind, detail) => findings.push({ page, kind, detail });

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

  // Debug logging left in a shipped page leaks internals to the console.
  for (const line of html.split(/\r?\n/)) {
    if (/console\.(log|debug|info)\(/.test(line) && !/DEBUG/.test(line)) {
      add(page, 'debug-log', line.trim().slice(0, 70));
    }
  }

  if (!/<html[^>]*\blang=/.test(html)) add(page, 'no-lang', 'html element');
  if (!/<meta[^>]+name="viewport"/i.test(html)) add(page, 'no-viewport', 'head');
  if (!/<title>[^<]+<\/title>/i.test(html)) add(page, 'no-title', 'head');
}

// The sitemap must list public pages and must not list disallowed ones.
// noindex pages and the redirecting root are public-but-unlisted by design.
if (existsSync(join(root, 'sitemap.xml'))) {
  const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  const listed = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].split('/').pop() || 'index.html'));
  const robots = existsSync(join(root, 'robots.txt')) ? readFileSync(join(root, 'robots.txt'), 'utf8') : '';
  const blocked = new Set([...robots.matchAll(/^Disallow:\s*\/(\S+)/gm)].map(m => m[1]));
  for (const page of pages) {
    if (blocked.has(page)) {
      if (listed.has(page)) add('sitemap.xml', 'sitemap-lists-blocked', page);
      continue;
    }
    if (page === 'index.html') continue; // 302s to the marketing host
    const html = readFileSync(join(root, page), 'utf8');
    if (/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html)) {
      if (listed.has(page)) add('sitemap.xml', 'sitemap-lists-noindex', page);
      continue;
    }
    if (!listed.has(page)) add('sitemap.xml', 'sitemap-missing', page);
  }
}

const byKind = findings.reduce((acc, f) => {  acc[f.kind] = (acc[f.kind] || 0) + 1;
  return acc;
}, {});

if (asJson) {
  console.log(JSON.stringify({ pages: pages.length, byKind, findings }, null, 2));
} else {
  for (const f of findings) console.log(`${f.page}\t${f.kind}\t${f.detail}`);
  console.log(`\n${pages.length} pages, ${findings.length} findings`);
  for (const [kind, n] of Object.entries(byKind)) console.log(`  ${kind}: ${n}`);
}

process.exit(findings.length ? 1 : 0);
