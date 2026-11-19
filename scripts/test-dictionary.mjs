#!/usr/bin/env node
// HanVerse Dictionary contract tests.
// Source-contract assertions plus a real unit test of the pinyin normaliser.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainPinyin, markedToNumbered } from '../functions/dictionary.js';
import { parseCedict, numberedToMarked } from './cedict-lib.mjs';

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
  assert(/CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_hanzi_reading/.test(dict), 'unique index not guarded');
  assert(/ON CONFLICT \(hanzi, pinyin\) DO NOTHING/.test(dict), 'starter seed not conflict-safe');
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
  assert(/Math\.min\(Math\.max\(Number\(req\.query\.limit\) \|\| 20, 1\), 50\)/.test(dict), 'limit not clamped');
  assert(/Math\.max\(Number\(req\.query\.offset\) \|\| 0, 0\)/.test(dict), 'offset not clamped');
  return 'limit ≤ 50, offset ≥ 0';
});

check('empty query still returns a page', () => {
  assert(/let rank = '0::int'/.test(dict), 'ORDER BY constant would be read as a column position');
  assert(!/ORDER BY 0[,)]/.test(dict), 'bare ORDER BY 0 present');
  return 'rank defaults to 0::int';
});

check('page can load more words', () => {
  const page = read('dictionary.html');
  assert(/id="dictMoreBtn"/.test(page), 'no load-more control');
  assert(/params\.set\('offset'/.test(page), 'offset never sent');
  assert(/search\(true\)/.test(page), 'load more does not append');
  assert(/seq !== state\.seq/.test(page), 'stale responses can overwrite newer results');
  return 'offset paging + stale-response guard';
});

check('level chips hide when nothing is levelled', () => {
  const page = read('dictionary.html');
  assert(/loadLevels\(\)/.test(page), 'levels never fetched');
  assert(/chip\.hidden = !counts\[level\]/.test(page), 'empty level chips stay visible');
  return 'chips follow /dictionary/levels';
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

console.log('\nCC-CEDICT import');

const FIXTURE = [
  '# comment',
  '好 好 [hao3] /good/well/',
  '好 好 [hao4] /to be fond of/',
  '你好 你好 [ni3 hao3] /hello/',
  '中國 中国 [Zhong1 guo2] /China/',
  '女 女 [nu:3] /female/',
  '嗎 吗 [ma5] /question particle/',
  '點兒 点儿 [dian3 r5] /a bit/',
  '裡 里 [li3] /inside/',
  '裏 里 [li3] /lining/'
].join('\n');

check('parser keeps both readings of 好', () => {
  const { entries } = parseCedict(FIXTURE);
  const hao = entries.filter(e => e.hanzi === '好').map(e => e.pinyin).sort();
  assert(hao.length === 2 && hao.includes('hǎo') && hao.includes('hào'), 'got ' + hao.join(','));
  return hao.join(' / ');
});

check('parser marks tones, ü and neutral tone', () => {
  assert(numberedToMarked('ni3 hao3') === 'nǐ hǎo', 'ni3 hao3');
  assert(numberedToMarked('nu:3') === 'nǚ', 'nu:3');
  assert(numberedToMarked('ma5') === 'ma', 'ma5');
  return 'nǐ hǎo, nǚ, ma';
});

check('parser merges traditional forms of one word', () => {
  const li = parseCedict(FIXTURE).entries.find(e => e.hanzi === '里');
  assert(li && li.traditional === '裡/裏', 'got ' + (li && li.traditional));
  return li.traditional;
});

check('parser output is searchable without tones', () => {
  const zg = parseCedict(FIXTURE).entries.find(e => e.hanzi === '中国');
  assert(zg && zg.pinyinPlain === plainPinyin('Zhōng guó') && zg.pinyinPlain === zg.pinyinPlain.toLowerCase(), 'plain form');
  return zg.pinyinPlain;
});

check('import never overwrites and needs --confirm', () => {
  const imp = read('scripts/import-cedict.mjs');
  assert(/ON CONFLICT \(hanzi, pinyin\) DO NOTHING/.test(imp), 'not conflict-safe');
  assert(/--confirm/.test(imp) && /FALSE\)/.test(imp), 'no confirm gate or reviewed default');
  assert(/TYPE TEXT/.test(dict), 'meaning not widened for long senses');
  return 'DO NOTHING, dry run by default, meaning TEXT';
});

check('stroke data is proxied and cached', () => {
  assert(/router\.get\('\/dictionary\/strokes\/:char'/.test(dict), 'no stroke route');
  assert(/hanzi-writer-data/.test(dict), 'no upstream stroke source');
  assert(/strokeCache/.test(dict), 'stroke data not cached');
  assert(/\\u4E00-\\u9FFF/.test(dict), 'stroke route does not restrict to one hanzi');
  return 'single hanzi, cached, server-side fetch';
});

check('word opens an expanded view with stroke animation', () => {
  const page = read('dictionary.html');
  assert(/vendor\/hanzi-writer\.min\.js/.test(page), 'Hanzi Writer not loaded');
  assert(existsSync(join(root, 'vendor/hanzi-writer.min.js')), 'vendored library missing');
  assert(/id="dictModal"/.test(page) && /role="dialog"/.test(page), 'no dialog');
  assert(/data-open="/.test(page), 'cards are not clickable');
  assert(/animateCharacter\(\)/.test(page) && /\.quiz\(\)/.test(page), 'no animation or practice');
  assert(/charDataLoader: loadStrokes/.test(page), 'writer does not use the proxy');
  return 'dialog + animate + practise';
});

check('word audio comes from audio-cmn and is proxied', () => {
  assert(/audio-cmn/.test(dict), 'no audio-cmn source');
  assert(/router\.get\('\/dictionary\/audio\/:word'/.test(dict), 'no word audio route');
  assert(/router\.get\('\/dictionary\/audio\/clip\/:dir\/:file'/.test(dict), 'no clip proxy');
  assert(/\['hsk', 'syllabs'\]\.includes\(dir\)/.test(dict), 'clip dir not whitelisted');
  assert(/markedToNumbered/.test(dict), 'no pinyin fallback for syllable clips');
  return 'hsk word clip, syllable fallback, whitelisted dirs';
});

check('marked pinyin converts to audio file names', () => {
  assert(markedToNumbered('nǐ') === 'ni3', 'nǐ');
  assert(markedToNumbered('hǎo') === 'hao3', 'hǎo');
  assert(markedToNumbered('nǚ') === 'nu3', 'nǚ');
  assert(markedToNumbered('ma') === 'ma5', 'ma');
  assert(markedToNumbered('lüè') === 'lue4', 'lüè');
  return 'ni3, hao3, nu3, ma5, lue4';
});

check('detail view autoplays strokes and audio', () => {
  const page = read('dictionary.html');
  assert(/animateCharacter\(\);\s*\n\s*playWord\(entry\)/.test(page), 'open does not autoplay both');
  assert(/delayBetweenStrokes: 300/.test(page), 'stroke animation too slow to feel automatic');
  assert(/id="dictAudio"/.test(page), 'no audio button');
  assert(/stopAudio\(\)/.test(page), 'audio not stopped on close');
  return 'strokes + audio on open, stopped on close';
});

check('page credits CC-CEDICT and its licence', () => {
  const page = read('dictionary.html');
  assert(/mdbg\.net\/chinese\/dictionary\?page=cc-cedict/.test(page), 'no source link');
  assert(/creativecommons\.org\/licenses\/by-sa\/4\.0/.test(page), 'no licence link');
  assert(/not been checked against the YCT/.test(page), 'no YCT disclaimer');
  return 'attribution + licence + disclaimer';
});

console.log(`\n${passed}/${passed + failed} checks passed\n`);
if (failed) process.exit(1);
