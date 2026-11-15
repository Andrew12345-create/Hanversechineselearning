#!/usr/bin/env node
/* Regression test: daily-warmup state must be scoped per account.
 *
 * Extracts the warmup storage logic from learn.html and simulates two
 * accounts on the same device (one localStorage). Passes when:
 *   1. No unscoped "hanverse_warmup" read/write remains.
 *   2. Two different uids get isolated warmup records (user B never sees
 *      or extends user A's streak).
 *
 * Run: node scripts/test-warmup-isolation.mjs
 */
'use strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'learn.html'), 'utf8');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 1. No bare shared-key access anywhere in the page.
check('no unscoped hanverse_warmup access',
  !/localStorage\.(get|set)Item\(\s*["']hanverse_warmup["']\s*[,)]/.test(html));

// 2. The scoped helper exists and embeds the uid.
const helper = /function warmupStorageKey\(\)\{[^}]*uid\(\)[^}]*\}/.test(html)
  || /warmupStorageKey\s*=/.test(html);
check('warmupStorageKey() derives from uid()', helper);

// 3. Behavioural simulation of the extracted logic.
const m = html.match(/function warmupKey\(([\s\S]*?)\{[\s\S]*?\n\}/);
const k = html.match(/function warmupStorageKey\(\)\{([\s\S]*?)\n\}/);
if (m && k) {
  const sandbox = { user: null, uid: () => (globalThis.__u?.user_id) || null };
  const warmupKey = new Function('user', 'uid', `${m[0]}; return warmupKey;`)(sandbox.user, sandbox.uid);
  const warmupStorageKey = new Function('user', 'uid', `${k[0]}; return warmupStorageKey;`)(sandbox.user, sandbox.uid);
  const store = new Map();
  const localStorage = {
    getItem: kk => store.get(kk) ?? null,
    setItem: (kk, v) => store.set(kk, String(v))
  };
  const today = new Date();
  const d = n => new Date(today.getTime() - n * 864e5);

  // User A logs today's warmup with streak 4.
  globalThis.__u = { user_id: 7 };
  const keyA = warmupStorageKey();
  const dateA = warmupKey(today);
  localStorage.setItem(keyA, JSON.stringify({ date: dateA, correct: 3, xp: 15, streak: 4 }));

  // User B opens the same device: must NOT see A's streak.
  globalThis.__u = { user_id: 9 };
  const seenByB = JSON.parse(localStorage.getItem(warmupStorageKey()) || 'null');
  check('user B does not see user A warmup', seenByB === null);

  // B completes a warmup: streak starts at 1 for B, and A's record is intact.
  localStorage.setItem(warmupStorageKey(), JSON.stringify({ date: dateA, correct: 2, xp: 10, streak: 1 }));
  globalThis.__u = { user_id: 7 };
  const seenByA = JSON.parse(localStorage.getItem(warmupStorageKey()) || 'null');
  check("user A's streak intact after B's session", seenByA?.streak === 4);

  // Distinct keys per uid.
  globalThis.__u = { user_id: 9 };
  check('keys differ per uid', warmupStorageKey() !== keyA, `${warmupStorageKey()} vs ${keyA}`);
} else {
  check('warmup helpers extractable from learn.html', false, 'pattern not found — inspect manually');
}

console.log(failures ? `\n❌ ${failures} failure(s)` : '\n✅ warmup isolation verified');
process.exit(failures ? 1 : 0);
