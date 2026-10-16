/* Trial end-to-end self-test: proves the 7-day free trial actually works.
   Creates a TEMP user, starts the trial via the API, checks status, simulates
   expiry, runs the REAL scheduled sweep function, verifies premium is cleared,
   then deletes the temp user. Prints no secrets. */
import fs from 'fs';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const secret = env.JWT_SECRET || process.env.JWT_SECRET;
const connectionString = env.DATABASE_URL || process.env.DATABASE_URL;

const results = [];
const record = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
const uname = 'hv_trial_selftest_' + Date.now();
let tempId = null;

try {
  // 1. create temp user (bypasses signup so we never email anyone)
  const ins = await pool.query(
    `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'selftest') RETURNING user_id`,
    [uname, uname + '@selftest.invalid']
  );
  tempId = ins.rows[0].user_id;

  const token = jwt.sign({ user_id: tempId, email: uname + '@selftest.invalid', role: 'student', is_admin: false }, secret, { expiresIn: '10m' });
  const { handler } = await import('../functions/server.js');
  const call = (method, path, body) => handler(
    { httpMethod: method, path, headers: { Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : null, isBase64Encoded: false },
    {}
  );
  const parse = r => { try { return JSON.parse(r.body); } catch { return {}; } };

  // 2. start the trial
  let r = parse(await call('POST', '/api/trial/start', {}));
  const endsAt = r.trialEndsAt ? new Date(r.trialEndsAt) : null;
  const days = endsAt ? (endsAt - Date.now()) / 86400000 : 0;
  record('trial starts', !!endsAt, `ends in ${days.toFixed(2)} days`);
  record('trial is exactly ~7 days', days > 6.98 && days < 7.02, `${days.toFixed(3)}d`);

  // 3. cannot start twice (server answers 'premium' because the first call
  //    made them premium; either guard message means re-trial is blocked)
  r = parse(await call('POST', '/api/trial/start', {}));
  record('re-start blocked', r.already === 'used' || r.already === 'premium', `server says: ${r.already || JSON.stringify(r)}`);

  // 4. status: active
  r = parse(await call('GET', `/api/trial/status/${tempId}`));
  record('status: active premium', r.isPremium === true && r.trialActive === true && r.trialUsed === true, JSON.stringify(r));

  // 5. pretend 7 days passed, run the REAL hourly sweep function
  await pool.query(`UPDATE users SET trial_ends_at = NOW() - INTERVAL '1 hour' WHERE user_id = $1`, [tempId]);
  const sweepMod = await import('../functions/trial-sweep.js');
  const sweepResp = await sweepMod.default({});
  const sweepBody = sweepResp ? await sweepResp.json() : {};
  record('scheduled sweep ran', sweepBody.success === true && sweepBody.expired >= 1, `expired=${sweepBody.expired}`);

  // 6. status: expired, and permanently used
  r = parse(await call('GET', `/api/trial/status/${tempId}`));
  record('trial expired correctly', r.isPremium === false && r.trialActive === false && r.trialUsed === true, JSON.stringify(r));

  // 7. and still cannot re-trial afterwards
  r = parse(await call('POST', '/api/trial/start', {}));
  record('no re-trial after expiry', r.already === 'used', `server says: ${r.already || JSON.stringify(r)}`);
} catch (e) {
  record('unexpected error', false, e.message);
} finally {
  if (tempId) await pool.query(`DELETE FROM users WHERE user_id = $1`, [tempId]);
  await pool.end();
}

const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
