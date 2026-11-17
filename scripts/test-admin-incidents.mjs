#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
const server = fs.readFileSync('functions/server.js', 'utf8');
const admin = fs.readFileSync('admin.html', 'utf8');
let failed = 0;
const test = (name, value) => { console.log(`${value ? '✅' : '❌'} ${name}`); if (!value) failed++; };

const readStart = server.indexOf("router.get('/admin/incidents'");
const createStart = server.indexOf("router.post('/admin/incidents'");
const patchStart = server.indexOf("router.patch('/admin/incidents/:id'");
const end = server.indexOf('ADMIN EMAIL BROADCAST', patchStart);
const readRoute = readStart >= 0 && createStart > readStart ? server.slice(readStart, createStart) : '';
const createRoute = createStart >= 0 && patchStart > createStart ? server.slice(createStart, patchStart) : '';
const patchRoute = patchStart >= 0 && end > patchStart ? server.slice(patchStart, end) : '';

test('incident read route is admin-authenticated', /router\.get\('\/admin\/incidents', verifyAdminToken, async \(req, res\)/.test(server));
test('incident create route is admin-authenticated', /router\.post\('\/admin\/incidents', verifyAdminToken, async \(req, res\)/.test(server));
test('incident update route is admin-authenticated', /router\.patch\('\/admin\/incidents\/:id', verifyAdminToken, async \(req, res\)/.test(server));
test('incident reads require system.read and writes system.manage', /if \(path === '\/admin\/incidents'\) return method === 'GET' \? 'system\.read' : 'system\.manage';/.test(server) && /if \(\/\^\\\/admin\\\/incidents\\\/\\d\+\$\/\.test\(path\)\) return 'system\.manage';/.test(server));
test('incident writes require a password step-up', /feature-flags\|incidents\)\//.test(server));
test('incident severity is validated', /INCIDENT_SEVERITIES = \['sev1', 'sev2', 'sev3', 'sev4'\]/.test(server) && /Severity must be sev1, sev2, sev3 or sev4/.test(createRoute));
test('incident status is validated', /INCIDENT_STATUSES = \['open', 'monitoring', 'resolved'\]/.test(server) && /Status must be open, monitoring or resolved/.test(patchRoute));
test('incident create audits inside the transaction', /insertAdminAudit\(client, req, 'incident\.create'[\s\S]{0,500}await client\.query\('COMMIT'\)/.test(createRoute));
test('incident update locks the row and audits before commit', /FOR UPDATE/.test(patchRoute) && /insertAdminAudit\(client, req, 'incident\.update'[\s\S]{0,600}await client\.query\('COMMIT'\)/.test(patchRoute));
test('incident update clears resolution when reopened', /CASE WHEN \$2 = 'resolved' THEN COALESCE\(resolved_at, NOW\(\)\) ELSE NULL END/.test(patchRoute));
test('incident writes roll back on failure', /await client\.query\('ROLLBACK'\)/.test(createRoute) && /await client\.query\('ROLLBACK'\)/.test(patchRoute));
test('incident table is created lazily', /CREATE TABLE IF NOT EXISTS incidents/.test(server));
test('incidents are visible in admin navigation', /data-section="incidents"/.test(admin) && /id="incidentsSection"/.test(admin));
test('incidents load on section open', /if \(section === "incidents"\) loadIncidents\(\);/.test(admin) && /async function loadIncidents\(\)/.test(admin));
test('incident console can open and transition incidents', /id="createIncidentButton"/.test(admin) && /data-incident-status/.test(admin));

console.log(`\n${failed ? `❌ ${failed} failure(s)` : '✅ admin incident centre checks passed'}`);
process.exit(failed ? 1 : 0);
