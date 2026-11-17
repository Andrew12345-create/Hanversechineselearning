#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
const server=fs.readFileSync('functions/server.js','utf8');
const admin=fs.readFileSync('admin.html','utf8');
let failed=0;const test=(n,v)=>{console.log(`${v?'✅':'❌'} ${n}`);if(!v)failed++};
test('broken legacy email-all endpoint is not publicly mounted', !/router\.post\('\/admin\/email-all'\s*,/.test(server));
test('user editor rejects privileged fields', /const \{ full_name, username, email, reason, \.\.\.unsupported \}/.test(server)&&/dedicated audited workflow/.test(server));
test('user editor validates core profile fields', /cleanName/.test(server)&&/cleanUsername/.test(server)&&/cleanEmail/.test(server));
test('user editor UI does not expose privileged controls', !/id="userPassword"|id="userRole"|id="userPremium"|id="userBanned"/.test(admin));
test('lesson delete uses one checked-out database client', /const client = await pool\.connect\(\)/.test(server)&&/await client\.query\('BEGIN'\)/.test(server)&&/client\.release\(\)/.test(server));
test('lesson delete writes its audit event before commit', /insertAdminAudit\(client, req, 'lesson\.delete'[\s\S]{0,500}await client\.query\('COMMIT'\)/.test(server));
test('bulk ban retains failed selections and reports a summary', /state\.bulkSelected = new Set\(failed\.map/.test(admin)&&/failed and remain selected/.test(admin));
test('bulk email no longer silently emails only the first selected user', !/ids\[0\][\s\S]{0,200}\.click\(\)/.test(admin));
console.log(`\n${failed?`❌ ${failed} failure(s)`:'✅ admin safety checks passed'}`);process.exit(failed?1:0);
