#!/usr/bin/env node
/* New games static tests — Sentence Builder (#7), Listening Detective (#5),
 * Pinyin Lab (#6). Source-level: wiring, handlers, saveSession names,
 * server whitelist, and content safety (no XSS via data attributes).
 *
 *   node scripts/test-new-games.mjs
 */
'use strict';
import { readFileSync } from 'node:fs';

let pass = 0, failCount = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  ok ? pass++ : failCount++;
}

const html = readFileSync('practice.html', 'utf8');
const features = readFileSync('functions/features.js', 'utf8');

// --- mode cards + wiring ---
for (const [mode, fn] of [['sentence', 'startSentenceBuilder'], ['listening', 'startListeningDetective'], ['pinyin', 'startPinyinLab']]) {
  check(`mode card data-mode="${mode}" exists`, html.includes(`data-mode="${mode}"`));
  check(`dispatch wires ${mode} → ${fn}`, new RegExp(`mode ===\\s*\n?\\s*"${mode}"[\\s\\S]{0,120}?${fn}\\(`).test(html));
  check(`${fn} is defined once`, html.split(`function ${fn}`).length === 2);
}

// --- handlers + buttons ---
for (const id of ['sbAgain', 'ldAgain', 'plAgain', 'ldPlay']) {
  check(`#${id} handler attached`, html.includes(`$("${id}")`));
}
check('sentence tokens rendered as buttons', html.includes('class="btn-ghost cn sb-token"'));
check('listening choices rendered', html.includes('class="btn-ghost ld-choice"'));
check('pinyin choices rendered', html.includes('class="btn-ghost pl-choice"'));

// --- correct data hooks ---
check('ld-choice carries data-hz', html.includes('data-hz="${c.hz}"'));
check('pl-choice carries data-c', html.includes('data-c="${c}"'));

// --- XSS safety: tokens/questions are inserted via template literals; verify
// the SENTENCE_DATA and PINYIN_QUESTIONS arrays contain no raw event handlers
// or script tags (all content is author-controlled, but assert it stays clean).
const gamesSection = html.slice(html.indexOf('SENTENCE_DATA'), html.indexOf('SMART REVIEW (spaced repetition)'));
check('game data has no inline handlers', !/\son\w+\s*=/.test(gamesSection));
check('game data has no script tags', !/<script/i.test(gamesSection));
check('game data has no javascript: URLs', !/javascript:/i.test(gamesSection));

// --- saveSession uses server-whitelisted names ---
for (const game of ['sentence_builder', 'listening_detective', 'pinyin_lab']) {
  check(`saveSession("${game}") called`, html.includes(`saveSession("${game}"`));
  check(`server whitelist includes ${game}`, features.includes(`'${game}'`));
}
check('whitelist regex still validates old games', features.includes("'tone_pairs'") && features.includes("'builder'"));

// --- rounds/XP consistent with cap rules (≤5 rounds games: 50 XP max, well under daily cap) ---
check('sentence builder is 5 rounds', /const rounds = 5;/.test(gamesSection));
check('listening + pinyin are ≤8 rounds', /const rounds = 8;/.test(gamesSection) && /const rounds = 6;/.test(gamesSection));

// --- accessibility ---
check('mode cards are keyboard-reachable (tabindex)', /data-mode="sentence"[\s]*[\r\n]+[\s]*tabindex="0"/.test(html) && /data-mode="listening"[\s]*[\r\n]+[\s]*tabindex="0"/.test(html) && /data-mode="pinyin"[\s]*[\r\n]+[\s]*tabindex="0"/.test(html));
check('audio has visible replay button', html.includes('Play the word'));

// --- learn.html entitlement banner intact from Phase 3 ---
const learn = readFileSync('learn.html', 'utf8');
check('entitlement banner still wired', learn.includes('entitlementBanner') && learn.includes('/account/entitlement'));

console.log(`\n${failCount ? `❌ ${failCount} FAILURE(S)` : '✅ all new-game tests passed'} (${pass} passed)`);
process.exit(failCount ? 1 : 0);
