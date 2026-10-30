#!/usr/bin/env node
/* Source-level regression checks for Features 13/14.
 * Run: node scripts/test-mastery-bests.mjs */
'use strict';
import fs from 'node:fs';
const features = fs.readFileSync('functions/features.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
let failed = 0;
function test(name, ok) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (!ok) failed++; }

test('personal bests endpoint requires authentication', /router\.get\('\/games\/personal-bests', requireAuth/.test(features));
test('personal bests query self-scopes by req.userId', /FROM game_sessions WHERE user_id = \$1[\s\S]{0,180}\[req\.userId\]/.test(features));
test('personal bests aggregates instead of exposing raw session history', /MAX\(score\)[\s\S]{0,80}best_score[\s\S]{0,500}GROUP BY game/.test(features));
test('mastery gate endpoint requires authentication', /router\.get\('\/learning\/mastery-gates', requireAuth/.test(features));
test('mastery gates use real lesson progress', /FROM user_progress WHERE user_id = \$1/.test(features));
test('mastery gates use real review data', /FROM review_queue WHERE user_id = \$1/.test(features));
test('mastery gates use real tone data', /FROM tone_stats WHERE user_id = \$1/.test(features));
test('mastery gates are explicitly informational (not entitlement enforcement)', /informational: it never silently removes access/.test(features));
test('dashboard includes a mastery-gate panel', /id="masteryGates"/.test(dashboard));
test('dashboard includes a personal-bests panel', /id="personalBests"/.test(dashboard));
test('dashboard obtains the stored JWT', /authToken = p\.token \|\| u\.token/.test(dashboard));
test('dashboard sends the JWT on authenticated requests', /Authorization: "Bearer " \+ authToken/.test(dashboard));
test('dashboard renders values with textContent, not interpolated HTML', /game\.textContent = String\(best\.game/.test(dashboard));
console.log(`\n${failed ? `❌ ${failed} failure(s)` : '✅ mastery and personal-bests checks passed'}`);
process.exit(failed ? 1 : 0);
