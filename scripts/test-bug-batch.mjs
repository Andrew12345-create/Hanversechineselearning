#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
const server = fs.readFileSync('functions/server.js', 'utf8');
const features = fs.readFileSync('functions/features.js', 'utf8');
const aiRoutes = fs.readFileSync('functions/ai-routes.js', 'utf8');
const aiHelpers = fs.readFileSync('functions/ai-helpers.js', 'utf8');
const savelevel = fs.readFileSync('functions/savelevel.cjs', 'utf8');
const signup = fs.readFileSync('functions/auth-signup.cjs', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const settings = fs.readFileSync('settings.html', 'utf8');
let failed = 0;
const test = (name, value) => { console.log(`${value ? '✅' : '❌'} ${name}`); if (!value) failed++; };

test('explore premium access resolves from the token entitlement', /async function exploreViewerEntitlement\(req\)/.test(server) && /exploreCanAccessPremium\(await exploreViewerEntitlement\(req\)\)/.test(server));
test('explore premium access requires premium rank', /entitlement\.active === true && entitlement\.rank >= PLAN_RANK\.premium/.test(server));
test('explore no longer reads the admin-only req.user', !/function isExplorePremiumUser/.test(server));
test('explore premium flag is computed once per request', /const canAccessPremium = exploreCanAccessPremium\(viewerEntitlement\);/.test(server));

test('ai usage route imports its usage reader', /usageFor/.test(aiRoutes.slice(0, aiRoutes.indexOf('const kidSafeRules'))) && /const rec = usageFor\(userId\);/.test(aiRoutes));

test('classroom mastery reads the real tone column', /SELECT ts\.tone_pair AS tone/.test(features) && /GROUP BY ts\.tone_pair/.test(features) && !/GROUP BY ts\.tone\b/.test(features));

test('feature routes refuse to mount without an admin verifier', /if \(typeof opts\.verifyAdminToken !== 'function'\) \{\s*throw new Error/.test(features) && !/verifyAdminToken \|\| \(\(_req, _res, next\) => next\(\)\)/.test(features));

test('trial sweep leaves paid memberships untouched', /AND \(membership_plan IS NULL OR membership_plan = 'free'\)/.test(features));

test('savelevel requires a bearer token', /jwt\.verify\(token, secret, \{ algorithms: \['HS256'\] \}\)/.test(savelevel) && /Sign in required\./.test(savelevel));
test('savelevel ignores a client-supplied user id', !/\{ userId, level \} = JSON\.parse/.test(savelevel) && /const userId = decoded && \(decoded\.user_id \|\| decoded\.id\)/.test(savelevel));
test('savelevel validates the level value', /typeof level !== 'string' \|\| level\.length > 40/.test(savelevel));

test('panda chat requires a signed-in learner', /router\.post\('\/panda-chat', authLimiter, async \(req, res\) => \{[\s\S]{0,400}const authUser = await requireUser\(req, res\);/.test(server));
test('panda chat identity comes from the token', /const userId = authUser\.user_id;/.test(server) && !/\$\{userId \|\| user_id \|\| 'guest'\}-panda/.test(server));
test('panda chat honours the daily cap and kill switch', /underLimit\(userId, 'pandaChat'\)/.test(server) && /markUsage\(userId, 'pandaChat'\)/.test(server) && /AI_DISABLED === '1'/.test(server));
test('panda chat has a bounded daily limit', /pandaChat: 30/.test(aiHelpers));

test('service worker falls back to cache for query-string navigations', /const cached = await caches\.match\(req, \{ ignoreSearch: true \}\);/.test(sw) && !/url\.search \? null : await caches\.match/.test(sw));

test('settings defines one shared toast helper', /window\.HVToast=toastMsg;/.test(settings) && (settings.match(/var toastMsg=window\.HVToast\|\|function/g) || []).length === 2 && !/function toastMsg\(message\)\{var t=document\.getElementById\('toast'\)/.test(settings));

test('signup hashes with a modern PBKDF2 work factor', /pbkdf2Sync\(password, salt, 210000, 64, 'sha512'\)/.test(signup) && /pbkdf2\$210000\$/.test(signup));

console.log(`\n${failed ? `❌ ${failed} failure(s)` : '✅ bug batch checks passed'}`);
process.exit(failed ? 1 : 0);
