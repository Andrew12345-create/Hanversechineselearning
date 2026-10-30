#!/usr/bin/env node
/* Parent/classroom suite tests — mastery reports (#23/#31), printable
 * worksheets (#32), YCT planner (#33). Source-level: authz chains,
 * privacy min-group rule, wiring and parse safety.
 *
 *   node scripts/test-parent-classroom.mjs
 */
'use strict';
import { readFileSync } from 'node:fs';

let pass = 0, failCount = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  ok ? pass++ : failCount++;
}

const server = readFileSync('functions/server.js', 'utf8');
const features = readFileSync('functions/features.js', 'utf8');
const parents = readFileSync('parents.html', 'utf8');
const cls = readFileSync('class.html', 'utf8');
const roadmap = readFileSync('roadmap.html', 'utf8');
const worksheets = readFileSync('worksheets.html', 'utf8');
const client = readFileSync('features-client.js', 'utf8');

// --- #23 parent mastery endpoint: exact sibling authz chain ---
const masteryRoute = server.slice(server.indexOf("router.get('/parents/child/:childId/mastery'"), server.indexOf("router.get('/parents/child/:childId/trend'"));
check('parent mastery route exists', masteryRoute.length > 100);
check('mastery uses requireUser (session)', /requireUser\(req, res\)/.test(masteryRoute));
check('mastery verifies parent role server-side', masteryRoute.includes("role !== 'parent'"));
check('mastery rejects unverified/banned parent', masteryRoute.includes('!parentUser.is_verified || parentUser.is_banned'));
check('mastery checks children.parent_id ownership', masteryRoute.includes("child.parent_id !== parentRecordCheck.rows[0].parent_id"));
check('mastery reads child-linked user_id, not client id', masteryRoute.includes('const childUserId = child.user_id;'));
for (const t of ['tone_stats', 'vocabulary_progress', 'user_progress', 'game_sessions', 'review_queue']) {
  check(`mastery aggregates ${t}`, masteryRoute.includes(t));
}
check('mastery tables fault-isolated (safe wrapper)', masteryRoute.includes("console.warn(`child mastery:"));

// --- #31 class mastery: teacher-only + privacy min group ---
const clsMastery = features.slice(features.indexOf("router.get('/classroom/mastery/:classCode'"), features.indexOf("router.get('/classroom/mine'"));
check('class mastery route exists', clsMastery.length > 100);
check('class mastery teacher-only', clsMastery.includes("if (!v.isTeacher) return fail(res, 403"));
check('class mastery min-group rule', clsMastery.includes('MIN_SKILL_GROUP = 3'));
check('class mastery excludes opt-out members', clsMastery.includes('share_leaderboard IS NOT FALSE'));
check('small-group stats return null (not numbers)', clsMastery.includes("students >= MIN_SKILL_GROUP"));

// --- client wiring ---
check('features-client exposes classroom.mastery', client.includes("mastery: (classCode) => api('/classroom/mastery/'"));
check('class.html renders mastery for teachers only', cls.includes('if(state.isTeacher) html+=renderMastery(o.mastery)'));
check('parents.html fetches child mastery with credentials', parents.includes("+ '/mastery', { credentials: 'include'") && parents.includes('/api/parents/child/'));
check('parents.html does NOT send child id from client state', !/mastery[^']*body\s*:/.test(parents));

// --- #32 printable worksheets ---
for (const frag of ['btnPrint', 'window.print()', 'Trace the characters', 'Match the pairs', 'Write a sentence']) {
  check(`worksheets has ${frag}`, worksheets.includes(frag));
}
check('worksheets escapes all words (XSS)', worksheets.includes("replace(/[&<>\"']/g"));
check('worksheets loads vocabulary via authed API only', worksheets.includes("F.api('/vocabulary')"));
check('worksheets falls back to starter words signed-out', worksheets.includes('FALLBACK'));
check('worksheets has print CSS', worksheets.includes('@media print'));
check('worksheets is noindex', worksheets.includes('noindex'));
check('robots disallows worksheets', readFileSync('robots.txt', 'utf8').includes('Disallow: /worksheets.html'));
check('parents page links to worksheets', parents.includes('href="/worksheets.html"'));
check('class page links to worksheets (teacher)', cls.includes("worksheets.html"));

// --- #33 YCT planner ---
check('planner card exists on roadmap', roadmap.includes('id="plannerCard"'));
check('planner computes lessons remaining', roadmap.includes('to go</b> at YCT'));
check('planner uses real lesson completion (no invented %)', /lvl\.filter\(complete\)\.length/.test(roadmap));
check('planner honest exam advice (no fake dates)', roadmap.includes('Hanban test centres') && roadmap.includes('a few times a year'));
check('planner hides when level has no lessons', roadmap.includes('card.hidden=true;return') || roadmap.includes('card.hidden = true'));

// --- parse safety ---
for (const f of ['parents.html', 'class.html', 'roadmap.html']) {
  const html = readFileSync(f, 'utf8');
  let bad = 0;
  for (const m of html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)) {
    try { new Function(m[1]); } catch { bad++; }
  }
  check(`${f} inline JS parses`, bad === 0, `${bad} bad block(s)`);
}

console.log(`\n${failCount ? `❌ ${failCount} FAILURE(S)` : '✅ all parent/classroom tests passed'} (${pass} passed)`);
process.exit(failCount ? 1 : 0);
