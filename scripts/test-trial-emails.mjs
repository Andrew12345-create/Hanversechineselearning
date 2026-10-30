#!/usr/bin/env node
/* Trial email system tests — no network, no real DB: the runner is exercised
 * with a fake pool + fake send; the scheduler core with synthetic users.
 *
 *   node scripts/test-trial-emails.mjs
 */
'use strict';
import { emailsDueForUser, buildTrialEmail, TRIAL_EMAIL_SCHEDULE, runTrialEmailSweep } from '../functions/trial-emails.js';

let pass = 0, failCount = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  ok ? pass++ : failCount++;
}

const T0 = new Date('2026-03-01T12:00:00Z');      // trial starts
const END = new Date(T0.getTime() + 7 * 864e5);   // trial ends
const d = n => new Date(T0.getTime() + n * 864e5);
const U = over => ({ trial_used: true, trial_ends_at: END.toISOString(), is_verified: true, is_banned: false, marketing_unsubscribed: false, ...over });
const keys = list => list.map(e => e.key).sort();

// --- schedule config sanity ---
eq('six emails configured', TRIAL_EMAIL_SCHEDULE.length, 6);
eq('days are 0,2,5,6,7,9', TRIAL_EMAIL_SCHEDULE.map(e => e.day).join(','), '0,2,5,6,7,9');
eq('day0 is transactional', TRIAL_EMAIL_SCHEDULE[0].promotional, false);
eq('day7 is transactional', TRIAL_EMAIL_SCHEDULE[4].promotional, false);

// --- timing windows ---
eq('nothing at -1d', keys(emailsDueForUser(U(), [], d(-1))), []);
eq('welcome due at day0', keys(emailsDueForUser(U(), [], d(0))), ['day0_welcome']);
eq('welcome expired by day2', keys(emailsDueForUser(U(), [], d(2))), ['day2_explore']);
eq('day5 window', keys(emailsDueForUser(U(), [], d(5))), ['day5_ending_soon']);
eq('day6 window', keys(emailsDueForUser(U(), [], d(6))), ['day6_last_day']);
eq('day7 ended window', keys(emailsDueForUser(U(), [], d(7))), ['day7_ended']);
eq('day9 followup window', keys(emailsDueForUser(U(), ['day7_ended'], d(9))), ['day9_followup']);
eq('everything eventually sent → quiet', keys(emailsDueForUser(U(), ['day0_welcome','day2_explore','day5_ending_soon','day6_last_day','day7_ended','day9_followup'], d(10))), []);
eq('day7 not sent before trial ends', keys(emailsDueForUser(U(), [], new Date(END.getTime() - 3600e3))), ['day6_last_day']);

// --- stop conditions ---
eq('upgraded users get no emails', emailsDueForUser(U({ membership_plan: 'premium', membership_status: 'active', premium_until: d(30) }), [], d(2)), []);
eq('banned users get no emails', emailsDueForUser(U({ is_banned: true }), [], d(0)), []);
eq('unverified users get no emails', emailsDueForUser(U({ is_verified: false }), [], d(0)), []);
eq('deleted account (null row) gets nothing', emailsDueForUser(null, [], d(0)), []);
eq('never-trialed user gets nothing', emailsDueForUser({ trial_used: false, trial_ends_at: null, is_verified: true, is_banned: false }, [], d(0)), []);
eq('opt-out at day2 (welcome sent) → nothing due', keys(emailsDueForUser(U({ marketing_unsubscribed: true }), ['day0_welcome'], d(2))), []);
eq('opted-out at day5 → nothing promotional', keys(emailsDueForUser(U({ marketing_unsubscribed: true }), ['day0_welcome'], d(5))), []);
eq('opted-out still gets day7 notice', keys(emailsDueForUser(U({ marketing_unsubscribed: true }), ['day0_welcome'], d(7))), ['day7_ended']);

// --- email content honesty (no manipulation, required disclosures) ---
const welcome = buildTrialEmail('day0_welcome', { username: 'Mei' }, T0);
eq('day0 subject mentions trial', /7 days? of Premium/i.test(welcome.subject), true);
eq('day0 says no card required', /no payment card required/i.test(welcome.html), true);
eq('day0 says nothing auto-renews', /nothing auto-renews|never auto-renews/i.test(welcome.html), true);
const ended = buildTrialEmail('day7_ended', { username: 'Mei' }, d(7));
eq('day7 thanks and says free plan', /free plan/i.test(ended.html), true);
eq('day7 prices match pricing table', /\$4\/month/.test(ended.html) && /\$10\/month/.test(ended.html), true);
const promo = buildTrialEmail('day2_explore', { username: 'Mei' }, d(2));
eq('promotional emails carry unsubscribe link', /Unsubscribe/i.test(promo.html), true);
for (const s of TRIAL_EMAIL_SCHEDULE) {
  const m = buildTrialEmail(s.key, { username: 'Mei' }, d(s.day));
  eq(`${s.key} renders subject+html`, typeof m.subject === 'string' && m.html.includes('</html>'), true);
  eq(`${s.key} has no countdown/fabricated scarcity`, /hurry|last chance|only today|!!!/i.test(m.html), false);
}

// --- runner: dedup claim, retry on failure, upgraded skip (fake pool) ---
function fakePool({ sendFails = false, candidates }) {
  const log = new Set(); const calls = { claims: 0, deletes: 0 };
  return {
    calls, log,
    async query(sql, params) {
      if (sql.startsWith('ALTER TABLE') || sql.startsWith('CREATE TABLE')) return { rows: [] };
      if (sql.includes('FROM users') && sql.includes('LIMIT')) return { rows: candidates };
      if (sql.startsWith('SELECT email_key FROM trial_email_log')) return { rows: [...log].filter(k => k.startsWith(`${params[0]}|`)).map(k => ({ email_key: k.split('|')[1] })) };
      if (sql.startsWith('INSERT INTO trial_email_log')) {
        calls.claims++;
        const k = `${params[0]}|${params[1]}`;
        if (log.has(k)) return { rows: [] };
        log.add(k); return { rows: [{ email_key: params[1] }] };
      }
      if (sql.startsWith('DELETE FROM trial_email_log')) { calls.deletes++; log.delete(`${params[0]}|${params[1]}`); return { rows: [] }; }
      throw new Error('fake pool: unexpected SQL: ' + sql.slice(0, 60));
    }
  };
}
const trialUser = U({ user_id: 7, email: 'mei@example.com', username: 'Mei' });

{ // dedup: two sweeps back to back → welcome sent exactly once
  const pool = fakePool({ candidates: [trialUser] });
  const sentLog = [];
  const send = async m => { sentLog.push(m.to); return { success: true }; };
  const r1 = await runTrialEmailSweep({ pool, send, now: d(0) });
  const r2 = await runTrialEmailSweep({ pool, send, now: d(0) });
  eq('first sweep sends welcome', r1.sent, 1);
  eq('second sweep sends nothing (dedup)', r2.sent, 0);
  eq('recipient email used from DB row', sentLog.length, 1);
}
{ // retry: send failure releases claim → next sweep retries
  const pool = fakePool({ candidates: [trialUser] });
  let failOnce = true;
  const send = async () => { if (failOnce) { failOnce = false; return { success: false, error: 'smtp down' }; } return { success: true }; };
  const r1 = await runTrialEmailSweep({ pool, send, now: d(0) });
  const r2 = await runTrialEmailSweep({ pool, send, now: d(0) });
  eq('failed send reported', r1.failed, 1);
  eq('retry after failure succeeds', r2.sent, 1);
  eq('failure released the claim', pool.calls.deletes >= 1, true);
}
{ // upgraded user: skipped, nothing claimed
  const pool = fakePool({ candidates: [trialUser && U({ user_id: 7, email: 'mei@example.com', username: 'Mei', membership_plan: 'yct', membership_status: 'active', premium_until: d(30) })] });
  const r = await runTrialEmailSweep({ pool, send: async () => ({ success: true }), now: d(2) });
  eq('upgraded: sent 0', r.sent, 0);
  eq('upgraded counted in skipped', r.skipped.upgraded, 1);
}
{ // dry run: due emails listed without claiming/sending
  const pool = fakePool({ candidates: [trialUser] });
  const r = await runTrialEmailSweep({ pool, send: async () => ({ success: true }), now: d(0), dryRun: true });
  eq('dry run lists due email', r.details[0] && r.details[0].key, 'day0_welcome');
  eq('dry run claims nothing', pool.calls.claims, 0);
}

console.log(`\n${failCount ? `❌ ${failCount} FAILURE(S)` : '✅ all trial-email tests passed'} (${pass} passed)`);
process.exit(failCount ? 1 : 0);
