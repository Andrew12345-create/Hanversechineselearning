#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
const features=fs.readFileSync('functions/features.js','utf8');
const server=fs.readFileSync('functions/server.js','utf8');
const settings=fs.readFileSync('settings.html','utf8');
const learn=fs.readFileSync('learn.html','utf8');
const parent=fs.readFileSync('parents.html','utf8');
const client=fs.readFileSync('features-client.js','utf8');
let failed=0;function test(n,v){console.log(`${v?'✅':'❌'} ${n}`);if(!v)failed++}
test('daily goal target requires auth',/router\.post\('\/goals\/target', requireAuth, writeLimiter/.test(features));
test('goal configuration uses server identity',/\[req\.userId, today, targetLessons, targetXp, targetSpeaking\]/.test(features));
test('goal presets are bounded',/xp: \[20, 50, 100, 200\], lessons: \[1, 2, 3\], speaking: \[0, 5, 10\]/.test(features));
test('goal update preserves earned fields by only updating target columns',/DO UPDATE SET\s+target_lessons = EXCLUDED\.target_lessons, target_xp = EXCLUDED\.target_xp, target_speaking = EXCLUDED\.target_speaking/.test(features));
test('new day inherits the optional speaking target',/COALESCE\(\(SELECT target_speaking FROM daily_goals/.test(features));
test('client exposes flexible goal helper',/setDailyTargets: \(\{ targetXp, targetLessons, targetSpeaking \}\)/.test(client));
test('settings visibly configures XP, lessons and speaking',/dailyGoalXp/.test(settings)&&/dailyGoalLessons/.test(settings)&&/dailyGoalSpeaking/.test(settings));
test('settings hydrates targets from authenticated daily quest',/F\.quests\.get\(F\.currentUserId\(\)\)/.test(settings));
test('learning rail visibly includes lesson and speaking targets',/speaking checks/.test(learn)&&/lessons/.test(learn));
test('controls require verified parent guard',/router\.get\('\/parents\/:parentId\/controls'[\s\S]{0,500}requireVerifiedParent/.test(server)&&/router\.put\('\/parents\/children\/:childUserId\/controls'[\s\S]{0,500}requireVerifiedParent/.test(server));
test('verified parent guard rejects unverified, banned or wrong role',/row\.role !== 'parent' \|\| !row\.is_verified \|\| row\.is_banned/.test(server));
test('controls response is minimized to necessary child fields',/SELECT c\.user_id, c\.full_name, c\.classroom_allowed, c\.share_classroom_profile, c\.controls_updated_at/.test(server));
test('parent UI explains classroom sharing effect and preserves progress',/hides them from classroom views; it does not remove their learning history/.test(parent));
test('parent UI escapes child names',/escapeHtml\(child\.full_name\)/.test(parent));
console.log(`\n${failed?`❌ ${failed} failure(s)`:'✅ goals and parent control checks passed'}`);process.exit(failed?1:0);
