#!/usr/bin/env node
/* Regression test: Tone Coach adaptive pair selection.
 *
 * Extracts pickWeakPairWord from practice.html's inline script and verifies:
 *   1. With no stats → null (pure random fallback is fine).
 *   2. The weakest pair (lowest accuracy, ≥2 attempts) is targeted.
 *   3. Mastered pairs (>85% accuracy) are left alone.
 *   4. Pairs with <2 attempts never drive selection.
 *
 * Run: node scripts/test-tone-adaptivity.mjs
 */
'use strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'practice.html'), 'utf8');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const fnSrc = html.match(/function pickWeakPairWord\(\) \{[\s\S]*?\n    \}/);
check('pickWeakPairWord exists in practice.html', Boolean(fnSrc));

if (fnSrc) {
  const TONE_WORDS = [
    { hz: '妈', py: 'mā', en: 'mother', tone: 1 },
    { hz: '骂', py: 'mà', en: 'scold', tone: 4 },
    { hz: '马', py: 'mǎ', en: 'horse', tone: 3 },
    { hz: '他', py: 'tā', en: 'he', tone: 1 }
  ];
  const make = toneMastery =>
    new Function('toneMastery', 'TONE_WORDS', `${fnSrc[0]}; return pickWeakPairWord;`)(toneMastery, TONE_WORDS);

  // 1. No stats → null.
  check('no stats → null (random fallback)', make({})() === null);

  // 2. Weakest pair targeted: 1-4 is 25% accurate, 1-2 is 100%.
  // The drill plays any word whose tone belongs to the weak pair — so over
  // repeated picks every result must carry a tone from {1, 4}, never from
  // the mastered pair's tone 2 (deterministic, no randomness flakes).
  const pick = make({ '1-4': { seen: 8, correct: 2 }, '1-2': { seen: 4, correct: 4 } });
  const picks = Array.from({ length: 20 }, () => pick());
  const inWeak = picks.every(w => w !== null && [1, 4].includes(w.tone));
  check('weakest pair drives selection', inWeak,
    `20 picks, tones seen: ${[...new Set(picks.map(w => w?.tone))].join(',') || 'none'}`);

  // 3. Everything mastered (>85%) → null.
  check('all mastered → null', make({ '1-4': { seen: 10, correct: 9 }, '1-2': { seen: 6, correct: 6 } })() === null);

  // 4. Under-2-attempt pairs don't drive selection.
  check('single-attempt pairs ignored', make({ '1-4': { seen: 1, correct: 0 } })() === null);
}

console.log(failures ? `\n❌ ${failures} failure(s)` : '\n✅ tone adaptivity verified');
process.exit(failures ? 1 : 0);
