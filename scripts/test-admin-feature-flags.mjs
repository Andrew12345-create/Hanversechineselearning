#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
const server = fs.readFileSync('functions/server.js', 'utf8');
const admin = fs.readFileSync('admin.html', 'utf8');
let failed = 0;
const test = (name, value) => { console.log(`${value ? '✅' : '❌'} ${name}`); if (!value) failed++; };

const readStart = server.indexOf("router.get('/admin/feature-flags'");
const writeStart = server.indexOf("router.patch('/admin/feature-flags/:key'");
const end = server.indexOf('router.', writeStart + 10);
const readRoute = readStart >= 0 && writeStart > readStart ? server.slice(readStart, writeStart) : '';
const writeRoute = writeStart >= 0 && end > writeStart ? server.slice(writeStart, end) : '';

test('feature flag read route is admin-authenticated', /router\.get\('\/admin\/feature-flags', verifyAdminToken, async \(req, res\)/.test(server));
test('feature flag write route is admin-authenticated', /router\.patch\('\/admin\/feature-flags\/:key', verifyAdminToken, async \(req, res\)/.test(server));
test('feature flag reads require system.read', /if \(path === '\/admin\/feature-flags'\) return method === 'GET' \? 'system\.read' : 'system\.manage';/.test(server));
test('feature flag writes require system.manage', /if \(\/\^\\\/admin\\\/feature-flags\\\/\[\^\/\]\+\$\/\.test\(path\)\) return 'system\.manage';/.test(server));
test('feature flag writes require a password step-up', /feature-flags\|incidents\)\//.test(server) && /requiresAdminReauthentication/.test(server));
test('feature flag key is validated', /\/\^\[a-z0-9_\]\{3,60\}\$\//.test(writeRoute));
test('feature flag rollout is bounded to 0-100', /rollout < 0 \|\| rollout > 100/.test(writeRoute));
test('feature flag update locks the row and audits before commit', /FOR UPDATE/.test(writeRoute) && /insertAdminAudit\(client, req, 'feature_flag\.update'[\s\S]{0,600}await client\.query\('COMMIT'\)/.test(writeRoute));
test('feature flag update rolls back on failure', /await client\.query\('ROLLBACK'\)/.test(writeRoute) && /client\.release\(\)/.test(writeRoute));
test('feature flag table is created lazily and seeded idempotently', /CREATE TABLE IF NOT EXISTS feature_flags/.test(server) && /ON CONFLICT \(flag_key\) DO NOTHING/.test(server));
test('feature flags are visible in admin navigation', /data-section="flags"/.test(admin) && /id="flagsSection"/.test(admin));
test('feature flags load on section open', /if \(section === "flags"\) loadFeatureFlags\(\);/.test(admin) && /async function loadFeatureFlags\(\)/.test(admin));
test('feature flag toggle sends a PATCH with a reason', /method: "PATCH"/.test(admin) && /data-flag-toggle/.test(admin));

console.log(`\n${failed ? `❌ ${failed} failure(s)` : '✅ admin feature flag checks passed'}`);
process.exit(failed ? 1 : 0);
