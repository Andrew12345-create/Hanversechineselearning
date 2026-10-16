/* Local smoke test: import handler (runs ensureFeatureSchema + trial sweep on real DB),
   then verify every feature endpoint is auth-guarded and responsive.
   Sends NO emails. Prints nothing secret.
   Usage: node scripts/smoke-features.mjs  */
const { handler } = await import('../functions/server.js');

function call(httpMethod, path, body = null, headers = {}) {
  return handler(
    {
      httpMethod,
      path,
      headers,
      body: body ? JSON.stringify(body) : null,
      isBase64Encoded: false
    },
    { /* mock context */ }
  );
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

// Every user-scoped feature endpoint must demand a JWT (401 without one).
// As a side effect of booting, the handler also ran ensureFeatureSchema()
// (proves review_queue/xp_logs/classrooms/etc. exist in Neon) and the
// trial-expiry sweep.
const guarded = [
  ['GET', '/api/quests/daily/1', null],
  ['POST', '/api/quests/progress', { kind: 'xp', amount: 10 }],
  ['POST', '/api/quests/claim-chest', {}],
  ['GET', '/api/streak/1', null],
  ['POST', '/api/streak/freeze', { payWithGems: false }],
  ['GET', '/api/review/deck/1', null],
  ['POST', '/api/review/answer', { word: '你好', quality: 3 }],
  ['POST', '/api/placement/submit', { correct: 5, total: 10 }],
  ['POST', '/api/games/session', { game: 'tone-pairs', score: 100, correct: 5, total: 6 }],
  ['GET', '/api/leaderboard/weekly/1', null],
  ['POST', '/api/leaderboard/optin', { optIn: true }],
  ['GET', '/api/referrals/stats/1', null],
  ['POST', '/api/trial/start', {}],
  ['GET', '/api/trial/status/1', null],
  ['POST', '/api/classroom/join', { classCode: 'HV00000' }],
  ['POST', '/api/classroom/create', { className: 'Test Class' }],
  ['GET', '/api/classroom/roster/UNKNOWNCODE', null],
  ['GET', '/api/pet/1', null],
  ['GET', '/api/gems/1', null],
  ['GET', '/api/hearts/1', null],
  ['POST', '/api/hearts/lose', {}],
  ['POST', '/api/hearts/refill', { mode: 'gems' }],
  ['GET', '/api/leaderboard/league/1', null],
  ['GET', '/api/review/mistakes/1', null],
  ['GET', '/api/achievements/1', null],
  ['POST', '/api/achievements/check/1', {}],
  ['POST', '/api/goals/target', { targetXp: 50 }],
  ['POST', '/api/parents/digest/send', {}] // admin route: 401 without token
];

for (const [method, path, body] of guarded) {
  const r = await call(method, path, body);
  const blocked = [401, 403].includes(r.statusCode);
  record(`guarded ${method} ${path}`, blocked, `status=${r.statusCode}`);
}

// Garbage tokens are rejected too, not just missing ones.
let r = await call('POST', '/api/games/session', { game: 'x' }, { Authorization: 'Bearer not.a.real.token' });
record('rejects forged token', [401, 403].includes(r.statusCode), `status=${r.statusCode}`);

const failed = results.filter(x => !x.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
console.log('Note: schema + trial sweep ran at boot — check the log above for "Feature-pack schema ensured".');
process.exit(failed ? 1 : 0);
