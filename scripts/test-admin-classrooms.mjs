#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
const server = fs.readFileSync('functions/server.js', 'utf8');
const admin = fs.readFileSync('admin.html', 'utf8');
let failed = 0;
const test = (name, value) => { console.log(`${value ? '✅' : '❌'} ${name}`); if (!value) failed++; };

const routeStart = server.indexOf("router.get('/admin/classrooms'");
const routeEnd = server.indexOf('ADMIN EMAIL BROADCAST', routeStart);
const route = routeStart >= 0 && routeEnd > routeStart ? server.slice(routeStart, routeEnd) : '';

test('classroom oversight route is mounted behind admin authentication', /router\.get\('\/admin\/classrooms', verifyAdminToken, async \(req, res\)/.test(server));
test('classroom oversight requires users.read', /if \(path === '\/admin\/classrooms'\) return 'users\.read';/.test(server));
test('classroom oversight is read-only', route.length > 0 && !/\b(INSERT INTO|UPDATE\s+|DELETE FROM)\b/i.test(route));
test('classroom oversight tolerates a database without classroom tables', /error\.code !== '42P01'/.test(route) && /available = false/.test(route));
test('classroom oversight caps the classroom list', /LIMIT 100/.test(route));
test('classroom oversight excludes learner email addresses', !/\bemail\s*,/.test(route) && !/u\.email/.test(route));
test('classroom oversight is visible in admin navigation', /data-section="classrooms"/.test(admin) && /id="classroomsSection"/.test(admin));
test('classroom oversight loads on section open', /if \(section === "classrooms"\) loadClassrooms\(\);/.test(admin) && /async function loadClassrooms\(\)/.test(admin));

console.log(`\n${failed ? `❌ ${failed} failure(s)` : '✅ admin classroom oversight checks passed'}`);
process.exit(failed ? 1 : 0);
