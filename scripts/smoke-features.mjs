/* Local smoke test: import handler (runs ensureFeatureSchema on real DB),
   then probe feature endpoints. Sends NO emails. Prints nothing secret. */
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

// 1. Digest endpoint must reject unauthenticated requests (admin guard)
let r = await call('POST', '/api/parents/digest/send', {});
record('digest rejects no-auth', [401, 403].includes(r.statusCode), `status=${r.statusCode}`);

// 2. Digest endpoint must reject a garbage token
r = await call('POST', '/api/parents/digest/send', {}, { Authorization: 'Bearer not.a.real.token' });
record('digest rejects bad token', [401, 403].includes(r.statusCode), `status=${r.statusCode}`);

// 3. Gems endpoint (feature-pack route + users.gems column) responds
r = await call('GET', '/api/gems/1');
let ok200 = r.statusCode === 200;
let parsed = {};
try { parsed = JSON.parse(r.body); } catch {}
record('GET /api/gems/1', ok200 && parsed.success === true, `status=${r.statusCode} gems=${parsed.gems}`);

// 4. Pet endpoint (derived stage) responds
r = await call('GET', '/api/pet/1');
parsed = {};
try { parsed = JSON.parse(r.body); } catch {}
record('GET /api/pet/1', r.statusCode === 200 && parsed.success === true, `status=${r.statusCode} stage=${parsed.stage}`);

// 5. Roster read (proves classrooms table exists) — unknown code => 200 empty
r = await call('GET', '/api/classroom/roster/UNKNOWNCODE');
parsed = {};
try { parsed = JSON.parse(r.body); } catch {}
record('GET /api/classroom/roster/UNKNOWNCODE', r.statusCode === 200 && Array.isArray(parsed.students), `status=${r.statusCode} students=${parsed.students && parsed.students.length}`);

// 6. Schema really is in the DB: query via a route that touches new tables
r = await call('GET', '/api/review/deck/1');
parsed = {};
try { parsed = JSON.parse(r.body); } catch {}
record('GET /api/review/deck/1 (review_queue table)', r.statusCode === 200, `status=${r.statusCode}`);

// 7. Weekly leaderboard (xp_logs + share_leaderboard column)
r = await call('GET', '/api/leaderboard/weekly/1');
parsed = {};
try { parsed = JSON.parse(r.body); } catch {}
record('GET /api/leaderboard/weekly/1', r.statusCode === 200 && parsed.success === true, `status=${r.statusCode} leaders=${parsed.leaders && parsed.leaders.length}`);

const failed = results.filter(x => !x.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
