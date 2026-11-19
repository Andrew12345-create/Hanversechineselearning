#!/usr/bin/env node
// Launch-readiness contract checks: the P0 hardening batch must stay in place.
// These are source-contract assertions, not runtime tests.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const detail = fn();
    passed++;
    console.log(`  ok  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name} — ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = read('functions/server.js');
const pkg = JSON.parse(read('package.json'));
const sw = read('sw.js');
const nav = read('shared-nav.js');

console.log('\nLaunch hardening');

check('npm test entrypoint exists', () => {
  assert(typeof pkg.scripts?.test === 'string', 'package.json has no test script');
  assert(existsSync(join(root, 'scripts/test-all.mjs')), 'scripts/test-all.mjs missing');
  return pkg.scripts.test;
});

check('JSON body limit is small by default', () => {
  assert(/express\.json\(\{\s*limit:\s*'100kb'\s*\}\)/.test(server), 'no 100kb json parser');
  assert(/express\.json\(\{\s*limit:\s*'2mb'\s*\}\)/.test(server), 'no 2mb json parser for lesson editor');
  assert(!/express\.json\(\{\s*limit:\s*'10mb'\s*\}\)/.test(server), '10mb parser still present');
  return '100kb default, 2mb for /admin/lessons';
});

check('shared limiter factory is used', () => {
  assert(/function makeLimiter\(/.test(server), 'makeLimiter missing');
  assert(/const writeLimiter = makeLimiter\(/.test(server), 'writeLimiter missing');
  assert(/const adminWriteLimiter = makeLimiter\(/.test(server), 'adminWriteLimiter missing');
  const write = (server.match(/writeLimiter, async/g) || []).length;
  const admin = (server.match(/adminWriteLimiter, async/g) || []).length;
  assert(write >= 15, `only ${write} writeLimiter attachments`);
  assert(admin >= 21, `only ${admin} adminWriteLimiter attachments`);
  return `${write} write + ${admin} admin routes limited`;
});

check('no unauthenticated write route is left unlimited', () => {
  const lines = server.split('\n');
  const unlimited = [];
  for (const line of lines) {
    if (!/^router\.(post|put|patch|delete)\(/.test(line)) continue;
    if (/Limiter/.test(line)) continue;
    unlimited.push(line.slice(0, 70));
  }
  assert(unlimited.length === 0, `unlimited: ${unlimited.join(' | ')}`);
  return 'every write route carries a limiter';
});

console.log('\nMissing pages');

for (const page of ['index.html', 'terms.html', 'privacy.html', 'refund-policy.html', 'cookie-policy.html']) {
  check(`${page} exists`, () => {
    assert(existsSync(join(root, page)), `${page} missing`);
    const html = read(page);
    assert(/<html lang="en">/.test(html), 'no lang attribute');
    assert(/class="skip-link"/.test(html), 'no skip link');
    return 'present';
  });
}

check('footer legal links are relative', () => {
  assert(!/hanverse\.netlify\.app\/terms\.html/.test(nav), 'absolute terms link still present');
  assert(/href="terms\.html"/.test(nav), 'relative terms link missing');
  assert(/href="privacy\.html"/.test(nav), 'relative privacy link missing');
  assert(/href="refund-policy\.html"/.test(nav), 'relative refund link missing');
  assert(/href="cookie-policy\.html"/.test(nav), 'relative cookie link missing');
  return 'all four relative';
});

check('legal pages carry real contact details and no placeholders', () => {
  for (const page of ['terms.html', 'privacy.html', 'refund-policy.html', 'cookie-policy.html']) {
    const html = read(page);
    assert(/<title>[^<]+<\/title>/.test(html), `${page} has no title`);
    assert(/mailto:/.test(html), `${page} has no contact route`);
    assert(!/REGISTERED ENTITY NAME|BUSINESS ADDRESS|CONTACT EMAIL|JURISDICTION/.test(html), `${page} still has unfilled placeholders`);
  }
  return '4 pages with real contact details';
});

console.log('\nPromises');

check('End-of-Year Exam promise removed', () => {
  const placement = read('placement.html');
  const profile = read('profile.html');
  assert(!/End-of-Year Exam/.test(placement), 'placement.html still promises the exam');
  assert(!/End-of-Year Exam/.test(profile), 'profile.html still promises the exam');
  return 'no unbuilt exam promised';
});

console.log('\nAccessibility');

check('skip links on every audited page', () => {
  const pages = ['vocabulary.html', 'placement.html', 'worksheets.html', 'payment.html', 'parents.html'];
  for (const page of pages) {
    assert(/class="skip-link"/.test(read(page)), `${page} has no skip link`);
  }
  return `${pages.length} pages`;
});

check('async regions announce updates', () => {
  const targets = [
    ['dashboard.html', 'masteryGates'],
    ['dashboard.html', 'personalBests'],
    ['notifications.html', 'notificationsList'],
    ['worksheets.html', 'wsBody'],
    ['placement.html', 'card'],
    ['explore.html', 'featuredGrid'],
    ['roadmap.html', 'lessons'],
    ['talk.html', 'chatBody'],
    ['practice.html', 'leaderboardCard']
  ];
  for (const [page, id] of targets) {
    const html = read(page);
    const tag = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
    assert(tag, `${page}: #${id} not found`);
    assert(/aria-live="polite"/.test(tag[0]), `${page}: #${id} has no aria-live`);
  }
  return `${targets.length} regions`;
});

check('touch target token is applied', () => {
  const css = read('hanverse.css');
  assert(/--touch:\s*48px/.test(css), '--touch token missing');
  assert(/min-height:\s*var\(--touch\)/.test(css), '--touch never applied');
  return 'min-height: var(--touch)';
});

check('global focus-visible ring exists', () => {
  const css = read('hanverse.css');
  assert(/:where\(a, button, input, select, textarea, summary, \[tabindex\]\):focus-visible/.test(css), 'no global focus ring');
  return 'present';
});

console.log('\nDead code');

check('unused client modules removed', () => {
  assert(!existsSync(join(root, 'js/api.js')), 'js/api.js still present');
  assert(!existsSync(join(root, 'js/offline-manager.js')), 'js/offline-manager.js still present');
  assert(!('gsap' in (pkg.dependencies || {})), 'gsap still a dependency');
  return 'api.js, offline-manager.js, gsap gone';
});

check('no sync-conflict copies in the tree', () => {
  const stray = readdirSync(root).filter(n => n.includes('sync-conflict'));
  assert(stray.length === 0, `found ${stray.join(', ')}`);
  return 'clean';
});

console.log('\nOffline');

check('service worker precaches learner destinations', () => {
  assert(/\/class\.html/.test(sw), 'class.html not precached');
  assert(/\/worksheets\.html/.test(sw), 'worksheets.html not precached');
  assert(/\/index\.html/.test(sw), 'index.html not precached');
  return 'class, worksheets, index';
});

check('navigation cache fallback ignores query strings', () => {
  assert(/caches\.match\(req, \{ ignoreSearch: true \}\)/.test(sw), 'ignoreSearch fallback missing');
  assert(!/url\.search \? null/.test(sw), 'query-string cache bypass still present');
  return 'deep links fall back to cache';
});

console.log(`\n${passed}/${passed + failed} checks passed\n`);
if (failed) process.exit(1);
