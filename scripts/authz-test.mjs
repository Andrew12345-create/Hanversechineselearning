/* Authorized-path test: mints a JWT with the real secret (never printed),
   calls protected endpoints, expects 200s. */
import fs from 'fs';
import jwt from 'jsonwebtoken';

// parse only the two keys we need, values never logged
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const token = jwt.sign(
  { user_id: 1, email: 'smoke@test.local', role: 'student', is_admin: false },
  env.JWT_SECRET || process.env.JWT_SECRET,
  { expiresIn: '10m' }
);

const { handler } = await import('../functions/server.js');
function call(method, path, body) {
  return handler({ httpMethod: method, path, headers: { Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : null, isBase64Encoded: false }, {});
}

let fails = 0;
for (const [m, p, b] of [
  ['GET', '/api/gems/1', null],
  ['GET', '/api/pet/1', null],
  ['GET', '/api/quests/daily/1', null],
  ['GET', '/api/streak/1', null],
  ['GET', '/api/leaderboard/weekly/1', null],
  ['GET', '/api/classroom/roster/UNKNOWNCODE', null],
  ['GET', '/api/trial/status/1', null],
]) {
  const r = await call(m, p, b);
  let d = {}; try { d = JSON.parse(r.body); } catch {}
  const pass = r.statusCode === 200 && d.success === true;
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${m} ${p}  status=${r.statusCode}`);
}
console.log(fails ? `\n${7 - fails}/7 passed` : '\n7/7 passed — authorized access works');
process.exit(fails ? 1 : 0);
