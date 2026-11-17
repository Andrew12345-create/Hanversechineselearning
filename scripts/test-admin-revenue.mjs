#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
const server = fs.readFileSync('functions/server.js', 'utf8');
const admin = fs.readFileSync('admin.html', 'utf8');
let failed = 0;
const test = (name, value) => { console.log(`${value ? '✅' : '❌'} ${name}`); if (!value) failed++; };

const routeStart = server.indexOf("router.get('/admin/revenue'");
const routeEnd = server.indexOf('/* ====', routeStart + 10);
const route = routeStart >= 0 && routeEnd > routeStart ? server.slice(routeStart, routeEnd) : '';

test('revenue console route is mounted behind admin authentication', /router\.get\('\/admin\/revenue', verifyAdminToken, async \(req, res\)/.test(server));
test('revenue console requires the finance.read permission', /if \(path === '\/admin\/revenue'\) return 'finance\.read';/.test(server));
test('revenue console is read-only', route.length > 0 && !/\b(INSERT INTO|UPDATE\s+users|DELETE FROM)\b/i.test(route));
test('revenue projection excludes email addresses', route.length > 0 && !/\bemail\s*,/.test(route) && !/,\s*email\b/.test(route) && !/u\.email/.test(route));
test('revenue console prices match the published plans', /REVENUE_PLAN_PRICES = \{ free: 0, yct: 4, premium: 10 \}/.test(server));
test('revenue console estimates MRR from active paid accounts', /mrr_usd: active \* price/.test(route) && /arr_usd: mrr \* 12/.test(route));
test('revenue console reports trial follow-up windows', /expiring_48h/.test(route) && /expired_unconverted/.test(route) && /INTERVAL '48 hours'/.test(route));
test('revenue console caps the recent account list', /LIMIT 50/.test(route));
test('revenue console is visible in admin navigation', /data-section="revenue"/.test(admin) && /id="revenueSection"/.test(admin));
test('revenue console loads on section open', /if \(section === "revenue"\) loadRevenue\(\);/.test(admin) && /async function loadRevenue\(\)/.test(admin));
test('revenue console renders plan and account tables', /id="revenuePlanTable"/.test(admin) && /id="revenueAccountTable"/.test(admin));

console.log(`\n${failed ? `❌ ${failed} failure(s)` : '✅ admin revenue console checks passed'}`);
process.exit(failed ? 1 : 0);
