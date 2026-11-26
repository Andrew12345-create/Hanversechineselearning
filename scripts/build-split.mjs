#!/usr/bin/env node
// Builds the per-host publish directory.
//
//   SITE_TARGET=marketing  -> marketing site only
//   SITE_TARGET=app        -> learning app only
//   unset                  -> every page (safe fallback, same as before)
//
// Netlify sets SITE_NAME automatically, so each project picks its own target
// without any dashboard configuration. Locally nothing is set and the full
// tree is produced, which is what the local server and the tests expect.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import {
  APP_HOST, MARKETING_HOST, APP_INDEXABLE, MARKETING_INDEXABLE,
  pagesFor, NOINDEX_PAGES
} from './site-map.mjs';

const root = resolve(import.meta.dirname, '..');
// DIST_DIR lets the test suite build into a scratch directory instead of the
// shared dist/, so two suites can never clobber each other's output.
const dist = process.env.DIST_DIR ? resolve(process.env.DIST_DIR) : join(root, 'dist');

const target =
  process.env.SITE_TARGET ||
  (process.env.SITE_NAME === 'hanverse' ? 'marketing'
    : process.env.SITE_NAME === 'learn-hanverse' ? 'app'
      : 'all');

// A Netlify build must never silently fall back to "all": that would publish
// every page on both hosts and undo the split. Fail loudly instead.
if (process.env.NETLIFY === 'true' && target === 'all') {
  console.error(
    `✗ build-split: running on Netlify but SITE_NAME="${process.env.SITE_NAME || ''}" ` +
    'did not match a known site. Refusing to publish the full tree to both hosts.\n' +
    '  Set SITE_TARGET=marketing or SITE_TARGET=app in the project environment.'
  );
  process.exit(1);
}

if (!['marketing', 'app', 'all'].includes(target)) {
  console.error(`✗ build-split: unknown SITE_TARGET "${target}"`);
  process.exit(1);
}

console.log(`build-split: target=${target}${process.env.SITE_NAME ? ` (SITE_NAME=${process.env.SITE_NAME})` : ''}`);

// Static assets every page needs. Directories are copied whole.
const ASSET_FILES = [
  'hanverse.css', 'legal.css', 'panda-chat.css',
  'hanverse.js', 'shared-nav.js', 'bottom-nav.js', 'nav-user.js',
  'features-client.js', 'notifications-client.js', 'notifications.js',
  'adventures.js', 'panda-chat.js',
  'manifest.json', 'sw.js', '_headers', 'testimonials.json',
  'Hanverse-logo.png', 'Hanverse-logo2.png', 'pay-hanverse-subscription-card.png'
];
const ASSET_DIRS = ['assets', 'js', 'vendor', '.well-known'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

let copied = 0;
for (const file of ASSET_FILES) {
  const from = join(root, file);
  if (!existsSync(from)) continue;
  cpSync(from, join(dist, file));
  copied += 1;
}
for (const dir of ASSET_DIRS) {
  const from = join(root, dir);
  if (!existsSync(from)) continue;
  cpSync(from, join(dist, dir), { recursive: true });
  copied += 1;
}
// marketing/ holds brand.css and the logo; its .html files are stale copies.
const marketingDir = join(root, 'marketing');
if (existsSync(marketingDir)) {
  mkdirSync(join(dist, 'marketing'), { recursive: true });
  for (const entry of readdirSync(marketingDir)) {
    if (entry.endsWith('.html')) continue;
    cpSync(join(marketingDir, entry), join(dist, 'marketing', entry), { recursive: true });
    copied += 1;
  }
}

const pages = pagesFor(target);
for (const page of pages) {
  const from = join(root, page);
  if (!existsSync(from)) {
    console.error(`✗ build-split: missing page ${page}`);
    process.exit(1);
  }
  cpSync(from, join(dist, page));
  copied += 1;
}

// ---------------------------------------------------------------- redirects
// Cross-host 301s first so they win over the clean-URL rewrites below.
const otherPages = target === 'marketing'
  ? pagesFor('app').filter(p => !pages.includes(p))
  : target === 'app'
    ? pagesFor('marketing').filter(p => !pages.includes(p))
    : [];

const rules = [];
if (target === 'marketing') {
  for (const page of otherPages) {
    rules.push(`/${page}  ${APP_HOST}/${page}  301!`);
    rules.push(`/${page.replace(/\.html$/, '')}  ${APP_HOST}/${page}  301!`);
  }
} else if (target === 'app') {
  // The app host has no home page; send it to the marketing site. This is the
  // redirect that used to loop, because it also applied to the marketing host.
  rules.push(`/  ${MARKETING_HOST}/  301!`);
  rules.push(`/index.html  ${MARKETING_HOST}/  301!`);
  for (const page of otherPages) {
    if (page === 'index.html') continue;
    rules.push(`/${page}  ${MARKETING_HOST}/${page}  301!`);
    rules.push(`/${page.replace(/\.html$/, '')}  ${MARKETING_HOST}/${page}  301!`);
  }
}

// Clean URLs for the pages this host actually serves.
for (const page of pages) {
  if (page === 'index.html' || page === '404.html') continue;
  rules.push(`/${page.replace(/\.html$/, '')}  /${page}  200`);
}
writeFileSync(join(dist, '_redirects'), `${rules.join('\n')}\n`);

// ------------------------------------------------------------ robots/sitemap
const host = target === 'marketing' ? MARKETING_HOST : target === 'app' ? APP_HOST : MARKETING_HOST;
const indexable = target === 'marketing' ? MARKETING_INDEXABLE : target === 'app' ? APP_INDEXABLE : [...MARKETING_INDEXABLE, ...APP_INDEXABLE];

const urls = indexable.map(page => `  <url><loc>${host}/${page}</loc><changefreq>monthly</changefreq></url>`);
if (target === 'marketing') {
  urls.unshift(`  <url><loc>${host}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`);
}
writeFileSync(join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);

const blocked = target === 'marketing'
  ? []
  : [...NOINDEX_PAGES, 'admin.html', 'class.html', 'child-profile.html', 'parent-dashboard.html',
    'vocabulary.html', 'worksheets.html', 'learn.html', 'lesson.html', 'roadmap.html',
    'practice.html', 'talk.html', 'placement.html', 'panda-wave.html'];
writeFileSync(join(dist, 'robots.txt'),
  ['User-agent: *', 'Allow: /', ...blocked.map(page => `Disallow: /${page}`), '',
    `Sitemap: ${host}/sitemap.xml`, ''].join('\n'));

console.log(`✓ build-split: ${target} -> dist/ (${copied} files, ${pages.length} pages, ${rules.length} redirect rules)`);
