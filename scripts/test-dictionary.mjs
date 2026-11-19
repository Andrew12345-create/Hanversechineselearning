#!/usr/bin/env node
// HanVerse Dictionary contract tests.
// Source-contract assertions plus a real unit test of the pinyin normaliser.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainPinyin } from '../functions/dictionary.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = p => readFileSync(join(root, p), 'utf8');

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

const dict = read('functions/dictionary.js');
const server = read('functions/server.js');
const page = read('dictionary.html');
const nav = read('shared-nav.js');
const bottom = read('bottom-nav.js');
const sw = read('sw.js');
const sitemap = read('sitemap.xml');

console.log('\nPinyin normaliser');

check('strips tone marks', () => {
  assert(plainPinyin('nǐ hǎo') === 'nihao', `got "${plainPinyin('nǐ hǎo')}"`);
  assert(plainPinyin('xiè xie') === 'xiexie', `got "${plainPinyin('xiè xie')}"`);
  assert(plainPinyin('tú shū guǎn') === 'tushuguan', `got "${plainPinyin('tú shū guǎn')}"`);
  return 'nǐ hǎo → nihao';
});

check('handles ü and spacing variants', () => {
  assert(plainPinyin('nǚ') === 'nv', `got "${plainPinyin('nǚ')}"`);
  assert(plainPinyin('ni hao') === plainPinyin('ni-hao'), 'space and hyphen disagree');
  assert(plainPinyin('  Nǐ Hǎo  ') === 'nihao', 'case or padding not normalised');
  return 'ü → v, spaces collapsed';
});

check('leaves plain ascii untouched', () => {
  assert(plainPinyin('hello') === 'hello', 'ascii changed');
  assert(plainPinyin('') === '', 'empty string changed');
  return 'stable';
});

console.log('\nSchema');

check('schema is idempotent', () => {
  assert(/CREATE TABLE IF NOT EXISTS dictionary_entries/.test(dict), 'entries table not guarded');
  assert(/CREATE TABLE IF NOT EXISTS dictionary_saves/.test(dict), 'saves table not guarded');
  assert(/CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_hanzi_pinyin/.test(dict), 'unique index not guarded');
  assert(/ON CONFLICT \(hanzi, pinyin_plain\) DO NOTHING/.test(dict), 'starter seed not conflict-safe');
  return 'IF NOT EXISTS + ON CONFLICT';
});

check('starter rows never overwrite a real dictionary', () => {
  assert(/SELECT COUNT\(\*\)::int AS n FROM dictionary_entries/.test(dict), 'no emptiness guard');
  assert(/if \(count\.rows\[0\]\.n === 0\)/.test(dict), 'seed not gated on empty table');
  return 'seeds only when empty';
});

check('starter rows are unreviewed', () => {
  const seed = dict.slice(dict.indexOf('STARTER_ENTRIES'), dict.indexOf('export async function ensureDictionarySchema'));
  assert(!/reviewed:\s*true/.test(seed), 'a starter row claims review');
  assert(/source VARCHAR\(32\) NOT NULL DEFAULT 'admin'/.test(dict), 'source column missing');
  return 'no unreviewed row claims review';
});

check('no SELECT * in the dictionary module', () => {
  assert(!/SELECT\s+\*\s+FROM/i.test(dict), 'SELECT * present');
  return 'explicit projections only';
});

console.log('\nRoutes');

check('search is public but rate limited', () => {
  assert(/router\.get\('\/dictionary\/search', searchLimiter,/.test(dict), 'search not limited');
  assert(/max: 90/.test(dict), 'search limiter max missing');
  return 'searchLimiter attached';
});

check('search caps page size', () => {
  assert(/Math\.min\(Math\.max\(Number\(req\.query\.limit\) \|\| 20, 1\), 50\)/.test(dict), 'limit not clamped to 50');
  assert(/Math\.max\(Number\(req\.query\.offset\) \|\| 0, 0\)/.test(dict), 'offset not clamped');
  return 'limit ≤ 50';
});

check('level filter is validated', () => {
  assert(/!\[1, 2, 3, 4\]\.includes\(level\)/.test(dict), 'level not validated');
  return '1–4 only';
});

check('saves require a verified session', () => {
  const saves = dict.match(/router\.(get|post|delete)\('\/dictionary\/saves[^']*', requireAuth/g) || [];
  assert(saves.length === 3, `only ${saves.length} of 3 save routes are authenticated`);
  return '3 authenticated routes';
});

check('admin authoring requires the admin verifier', () => {
  const admin = dict.match(/router\.(post|patch)\('\/admin\/dictionary[^']*', requireAdmin/g) || [];
  assert(admin.length === 2, `only ${admin.length} of 2 admin routes are guarded`);
  return '2 guarded routes';
});

check('module refuses to mount without auth', () => {
  assert(/requires the shared user authenticator/.test(dict), 'no requireUser guard');
  assert(/requires the shared admin verifier/.test(dict), 'no admin guard');
  return 'fails closed';
});

check('saves are scoped to the signed-in user', () => {
  assert(/WHERE s\.user_id = \$1/.test(dict), 'saves not scoped by user');
  assert(/WHERE user_id = \$1 AND entry_id = \$2/.test(dict), 'delete not scoped by user');
  assert(!/req\.body\.userId/.test(dict), 'client-supplied userId trusted');
  return 'req.userId only';
});

check('mounted in server.js', () => {
  assert(/import \{ registerDictionaryRoutes, ensureDictionarySchema \} from '\.\/dictionary\.js'/.test(server), 'not imported');
  assert(/registerDictionaryRoutes\(router, pool, \{ requireUser, verifyAdminToken \}\)/.test(server), 'not registered');
  assert(/ensureDictionarySchema\(pool\)/.test(server), 'schema not warmed at boot');
  return 'imported, registered, warmed';
});

console.log('\nFrontend');

check('dictionary page exists and is accessible', () => {
  assert(existsSync(join(root, 'dictionary.html')), 'dictionary.html missing');
  assert(/<html lang="en">/.test(page), 'no lang');
  assert(/class="skip-link" href="#main"/.test(page), 'no skip link');
  assert(/id="main"/.test(page), 'no main target');
  assert(/aria-live="polite"/.test(page), 'no live region');
  assert(/lang="zh-Hans"/.test(page), 'hanzi not language-tagged');
  return 'skip link, live region, zh-Hans';
});

check('page escapes rendered values', () => {
  assert(/function esc\(value\)/.test(page), 'no escape helper');
  assert(/esc\(entry\.hanzi\)/.test(page), 'hanzi not escaped');
  assert(/esc\(entry\.meaning\)/.test(page), 'meaning not escaped');
  return 'all fields escaped';
});

check('page uses the shared api helper', () => {
  assert(/features-client\.js/.test(page), 'features-client not loaded');
  assert(/API\.api\('\/dictionary\/search\?'/.test(page), 'search not using shared helper');
  return 'HanVerseFeatures.api';
});

check('nav entries added', () => {
  assert(/href="dictionary\.html">Dictionary/.test(nav), 'shared-nav missing entry');
  assert(/href: 'dictionary\.html'/.test(bottom), 'bottom-nav missing entry');
  return 'top nav + More sheet';
});

check('offline and sitemap updated', () => {
  assert(/\/dictionary\.html/.test(sw), 'not precached');
  assert(/dictionary\.html/.test(sitemap), 'not in sitemap');
  return 'precache + sitemap';
});

console.log(`\n${passed}/${passed + failed} checks passed\n`);
if (failed) process.exit(1);
