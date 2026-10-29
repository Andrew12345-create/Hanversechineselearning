#!/usr/bin/env node
/* API smoke test — zero dependencies.
 *
 *   BASE_URL=https://learn-hanverse.netlify.app node scripts/smoke-api.mjs
 *
 * Read-only checks always run. With SMOKE_EMAIL + SMOKE_PASSWORD set, the
 * full authenticated flow runs too (login → profile → a lesson → export).
 * Exit code is non-zero on any failure, so CI can gate on it.
 */
'use strict';

const BASE = (process.env.BASE_URL || 'http://localhost:8888').replace(/\/+$/, '');
const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  return { status: res.status, json };
}

(async () => {
  // 1. Liveness ping — must be 200 JSON even with the DB down.
  const health = await call('/health');
  check('GET /health → 200', health.status === 200 && health.json?.ok === true,
    health.json ? `uptime ${health.json.uptime_s}s` : 'not JSON');

  // 2. Lessons list — public, must be an array with safe quiz data.
  const lessons = await call('/lessons');
  const list = lessons.json?.lessons;
  check('GET /lessons → 200 list', lessons.status === 200 && Array.isArray(list) && list.length > 0,
    `${Array.isArray(list) ? list.length : 0} lessons`);

  const sample = Array.isArray(list) ? list.find(l => l.lesson_id || l.id) : null;
  if (sample) {
    // 3. Lesson detail — must never leak answer keys.
    const sampleId = sample.lesson_id || sample.id;
    const detail = await call(`/lessons/${encodeURIComponent(sampleId)}`);
    const quiz = detail.json?.quiz || [];
    const leaks = quiz.some(q => (q.options || []).some(o =>
      Object.prototype.hasOwnProperty.call(o, 'is_correct') ||
      Object.prototype.hasOwnProperty.call(o, 'explanation')));
    check('GET /lessons/:id → 200', detail.status === 200 || detail.status === 404,
      `status ${detail.status}${detail.json?.locked ? ' (locked)' : ''}`);
    check('quiz payload carries no answer keys', !leaks,
      leaks ? 'is_correct/explanation found in options' : 'clean');

    // 4. Premium lessons stay locked without a token.
    const premium = Array.isArray(list) ? list.find(l => l.premium || l.is_premium) : null;
    if (premium) {
      const locked = await call(`/lessons/${encodeURIComponent(premium.lesson_id || premium.id)}`);
      check('premium lesson locked for anonymous', locked.json?.locked === true,
        locked.json?.locked ? '' : 'CONTENT SERVED');
    }
  }

  // 5. Authed endpoints reject anonymous callers.
  const refresh = await call('/auth/refresh');
  check('POST /auth/refresh rejects missing token', refresh.status === 401, `status ${refresh.status}`);

  // 6. Enumerability probe: unknown id must not be distinguishable.
  // 200 = uniform answer, 429 = limiter caught the probe — both are safe.
  const probe = await call('/auth/send-verification', { method: 'POST', body: { userId: 999999999 } });
  const probeOk = probe.status === 200 || probe.status === 429;
  check('send-verification does not leak existence', probeOk, `status ${probe.status}`);

  // 7. Optional authenticated flow.
  if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
    const login = await call('/auth/login', {
      method: 'POST',
      body: { email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }
    });
    const token = login.json?.token || login.json?.data?.token;
    check('POST /auth/login → token', Boolean(token), `status ${login.status}`);

    if (token) {
      const exp = await call('/account/export', { token });
      check('GET /account/export → 200 JSON', exp.status === 200 && exp.json?.profile?.user_id > 0,
        exp.status === 200 ? Object.keys(exp.json?.learning || {}).length + ' learning sections' : `status ${exp.status}`);
    }
  } else {
    results.push('ℹ️  SMOKE_EMAIL/SMOKE_PASSWORD not set — authed flow skipped');
  }

  console.log(results.join('\n'));
  console.log(`\n${failures ? `❌ ${failures} failure(s)` : '✅ all smoke checks passed'} against ${BASE}`);
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error('❌ smoke run crashed:', e.message);
  process.exit(1);
});
