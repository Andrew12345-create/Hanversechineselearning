#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
const server = fs.readFileSync('functions/server.js', 'utf8');
const features = fs.readFileSync('functions/features.js', 'utf8');
const parents = fs.readFileSync('parents.html', 'utf8');
let failed = 0;
function test(name, ok) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (!ok) failed++; }
test('learner assignment list initializes the schema', /router\.get\('\/my\/assignments'[\s\S]{0,400}await ensureParentTables\(\)/.test(server));
test('learner completion is self-scoped by authenticated user', /router\.post\('\/my\/assignments\/:assignmentId\/complete'[\s\S]{0,900}child_user_id = \$2[\s\S]{0,120}\[assignmentId, auth\.user_id\]/.test(server));
test('parent assignment writes still check family ownership', /router\.post\('\/parents\/:parentId\/assignments'[\s\S]{0,900}getOwnChild\(res, auth/.test(server));
test('parent controls use owned-child relationship verification', /router\.put\('\/parents\/children\/:childUserId\/controls'[\s\S]{0,650}getOwnChild\(res, auth/.test(server));
test('controls only accept real booleans', /typeof allowed !== 'boolean' \|\| typeof sharing !== 'boolean'/.test(server));
test('classroom privacy control synchronizes existing roster privacy flag and revokes membership when disabled', /UPDATE users SET share_leaderboard = \$1, class_code = CASE WHEN \$1 = FALSE THEN NULL ELSE class_code END WHERE user_id = \$2/.test(server));
test('classroom join enforces parent classroom permission server-side', /classroom\/join[\s\S]{0,850}classroom_allowed === false/.test(features));
test('parent hub visibly exposes Controls & Privacy', /data-tab="controls"/.test(parents) && /Controls & Privacy/.test(parents));
test('controls render child data with escaping', /escapeHtml\(child\.full_name\)/.test(parents));
test('controls save through the authenticated API', /parents\/children\/\$\{childUserId\}\/controls/.test(parents));
console.log(`\n${failed ? `❌ ${failed} failure(s)` : '✅ assignment and controls checks passed'}`);
process.exit(failed ? 1 : 0);
