#!/usr/bin/env node
// Release gate for the two-host split. Asserts that:
//   * every page belongs to exactly one host
//   * every page has an absolute canonical pointing at that host
//   * no app page is indexable, and no marketing page is noindex
//   * the per-host build emits only that host's pages
//   * each host's _redirects sends the other host's pages across with a 301
//   * the app host's "/" does not loop back to itself
//
// Run: node scripts/test-site-structure.mjs

import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  MARKETING_PAGES, APP_PAGES, SHARED_PAGES, NOINDEX_PAGES,
  MARKETING_HOST, APP_HOST
} from './site-map.mjs';

const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(join(root, file), 'utf8');

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};

const all = [...MARKETING_PAGES, ...APP_PAGES, ...SHARED_PAGES];
const onDisk = readdirSync(root).filter(f => f.endsWith('.html'));

check('every html page is assigned to a host',
  onDisk.every(page => all.includes(page)),
  onDisk.filter(page => !all.includes(page)).join(', '));

check('no page is assigned to both hosts',
  MARKETING_PAGES.every(page => !APP_PAGES.includes(page)),
  MARKETING_PAGES.filter(page => APP_PAGES.includes(page)).join(', '));

check('every assigned page exists', all.every(page => existsSync(join(root, page))),
  all.filter(page => !existsSync(join(root, page))).join(', '));

// Canonicals
const canonicalOf = page => {
  const html = read(page);
  const tags = [...html.matchAll(/<link\s+rel=["']canonical["'][^>]*href=["']([^"']+)["']/gi)].map(m => m[1]);
  return tags;
};

for (const page of [...MARKETING_PAGES, ...APP_PAGES]) {
  const tags = canonicalOf(page);
  const expected = MARKETING_PAGES.includes(page)
    ? (page === 'index.html' ? `${MARKETING_HOST}/` : `${MARKETING_HOST}/${page}`)
    : `${APP_HOST}/${page}`;
  check(`${page} has one absolute canonical`, tags.length === 1 && tags[0] === expected,
    tags.length ? tags.join(' | ') : 'none');
}

for (const page of SHARED_PAGES) {
  check(`${page} has no canonical`, canonicalOf(page).length === 0, canonicalOf(page).join(' | '));
}

// Indexability
for (const page of NOINDEX_PAGES) {
  check(`${page} is noindex`,
    /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(read(page)));
}
for (const page of MARKETING_PAGES) {
  check(`${page} is indexable`,
    !/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(read(page)));
}

// Build output. Build into a scratch directory so this suite never races the
// real dist/ that other suites and the deploy use.
const dist = mkdtempSync(join(tmpdir(), 'hanverse-split-'));
const build = target => {
  execFileSync(process.execPath, [join(root, 'scripts', 'build-split.mjs')], {
    cwd: root,
    env: { ...process.env, SITE_TARGET: target, DIST_DIR: dist },
    stdio: 'pipe'
  });
  return readdirSync(dist).filter(f => f.endsWith('.html'));
};

const marketingBuild = build('marketing');
check('marketing build ships only marketing pages',
  marketingBuild.every(page => MARKETING_PAGES.includes(page) || SHARED_PAGES.includes(page)),
  marketingBuild.filter(page => !MARKETING_PAGES.includes(page) && !SHARED_PAGES.includes(page)).join(', '));
check('marketing build ships every marketing page',
  MARKETING_PAGES.every(page => marketingBuild.includes(page)),
  MARKETING_PAGES.filter(page => !marketingBuild.includes(page)).join(', '));

const marketingRedirects = readFileSync(join(dist, '_redirects'), 'utf8');
check('marketing host 301s app pages to the app host',
  APP_PAGES.every(page => marketingRedirects.includes(`${APP_HOST}/${page}  301!`)),
  'missing app 301s');
check('marketing host does not redirect its own root',
  !/^\/\s+\S+\s+301!/m.test(marketingRedirects), 'root redirect present');

const appBuild = build('app');
check('app build ships only app pages',
  appBuild.every(page => APP_PAGES.includes(page) || SHARED_PAGES.includes(page)),
  appBuild.filter(page => !APP_PAGES.includes(page) && !SHARED_PAGES.includes(page)).join(', '));
check('app build ships every app page',
  APP_PAGES.every(page => appBuild.includes(page)),
  APP_PAGES.filter(page => !appBuild.includes(page)).join(', '));

const appRedirects = readFileSync(join(dist, '_redirects'), 'utf8');
check('app host 301s marketing pages to the marketing host',
  MARKETING_PAGES.filter(page => page !== 'index.html')
    .every(page => appRedirects.includes(`${MARKETING_HOST}/${page}  301!`)),
  'missing marketing 301s');
check('app host root goes to the marketing host',
  /^\/\s+https:\/\/hanverse\.netlify\.app\/\s+301!/m.test(appRedirects), 'no root 301');
check('app host root does not point at itself',
  !/^\/\s+https:\/\/learn-hanverse\.netlify\.app\/?\s+301!/m.test(appRedirects), 'self redirect');

// Per-host robots and sitemap
const appRobots = readFileSync(join(dist, 'robots.txt'), 'utf8');
check('app robots points at the app sitemap',
  appRobots.includes(`Sitemap: ${APP_HOST}/sitemap.xml`), appRobots.split('\n').pop());
check('app robots blocks the signed-in shells',
  NOINDEX_PAGES.every(page => appRobots.includes(`Disallow: /${page}`)), 'missing disallow');

const appSitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
check('app sitemap lists only indexable app pages',
  [...appSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .every(m => m[1].startsWith(`${APP_HOST}/`) &&
      !NOINDEX_PAGES.some(page => m[1].endsWith(`/${page}`))),
  'noindex page listed');

build('marketing');
const marketingRobots = readFileSync(join(dist, 'robots.txt'), 'utf8');
check('marketing robots points at the marketing sitemap',
  marketingRobots.includes(`Sitemap: ${MARKETING_HOST}/sitemap.xml`), marketingRobots.split('\n').pop());

// Navigation must not use relative links to the other host.
const nav = read('shared-nav.js');
check('shared nav links to the app host absolutely',
  /var APP = 'https:\/\/learn-hanverse\.netlify\.app'/.test(nav) &&
  !/href="learn\.html"/.test(nav), 'relative app link in shared-nav.js');

rmSync(dist, { recursive: true, force: true });

console.log(`\n${failed ? `FAIL ${failed} structure check(s)` : 'site structure checks passed'}`);
process.exit(failed ? 1 : 0);
