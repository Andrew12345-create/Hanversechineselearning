#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
const signup = fs.readFileSync('signup.html', 'utf8');
const parents = fs.readFileSync('parents.html', 'utf8');
const server = fs.readFileSync('functions/server.js', 'utf8');
let failed = 0;
function test(name, ok) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (!ok) failed++; }

test('server rejects self-registered students under 13', /userRole === 'student'[\s\S]{0,350}signupAge < 13/.test(server));
test('server directs under-13 learners to a parent-created account', /parent-created account[\s\S]{0,150}Parent Dashboard/.test(server));
test('child creation requires an authenticated parent', /router\.post\('\/parents\/children',[^\n]*[\s\S]{0,300}requireUser/.test(server));
test('child creation checks verified parent state', /parents\/children[\s\S]{0,900}is_verified/.test(server));
test('signup has a persistent under-13 parent-first notice', /id="under13Notice"/.test(signup) && /Add Child/.test(signup));
test('age changes switch under-13 users to Parent', /function updateParentFirstJourney[\s\S]{0,700}selectRole\('parent'\)/.test(signup));
test('signup supports the intentional parent URL mode', /get\('type'\) === 'parent'\) selectRole\('parent'\)/.test(signup));
test('parent signup does not send the child age as the parent age', /if \(selectedRole === 'student' && ageSelect && ageSelect\.value\)/.test(signup));
test('under-13 notice is announced accessibly', /role="status" aria-live="polite"/.test(signup));
test('parent child form uses the server password floor', /At least 8 characters/.test(parents) && /password\.length < 8/.test(parents));
test('parent child form errors are announced', /id="addChildError" role="alert" aria-live="assertive"/.test(parents));
test('child creation uses authenticated API helper', /await authFetch\('\/parents\/children'/.test(parents));
test('child creation never sends a client parentId', !/parentId:\s*parentUser\.user_id/.test(parents));
console.log(`\n${failed ? `❌ ${failed} failure(s)` : '✅ under-13 onboarding checks passed'}`);
process.exit(failed ? 1 : 0);
