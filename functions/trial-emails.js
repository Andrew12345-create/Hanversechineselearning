'use strict';
/* ========================================================================
 * TRIAL EMAIL SYSTEM — 7-day Premium trial journey (Priority Two).
 *
 * Sequence (configurable via TRIAL_EMAIL_SCHEDULE):
 *   day 0  Welcome to Premium trial        (transactional)
 *   day 2  Discover your Premium features  (promotional)
 *   day 5  Your trial ends in two days     (promotional)
 *   day 6  Your trial ends tomorrow        (promotional)
 *   day 7  Your trial has ended            (transactional)
 *   day 9  Friendly follow-up if not upgraded (promotional)
 *
 * Guarantees:
 *  - Idempotent: trial_email_log UNIQUE(user_id, email_key); a send is
 *    claimed before sending, the claim is released on failure so a later
 *    run retries. No duplicate sends under normal operation.
 *  - Stops when the user upgrades (paid membership active).
 *  - Stops when the account is deleted (no row → no candidate).
 *  - Promotional emails stop when the user opts out
 *    (users.marketing_unsubscribed); transactional notices (welcome,
 *    trial ended) still respect the account lifecycle.
 *  - Never renews, never asks for a card, no countdowns or fake scarcity.
 *  - Windows are UTC-based (serverless job); see docs note in report.
 * ======================================================================== */
import { computeEntitlement } from './entitlements.js';
import nodemailer from 'nodemailer';

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 7;

function siteUrl() {
  return process.env.PUBLIC_SITE_URL || process.env.URL || 'https://learn-hanverse.netlify.app';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function shell(title, bodyHtml, { promotional = false } = {}) {
  const unsub = promotional
    ? `<p style="color:#9CA3AF;font-size:12px;margin-top:24px;">You're getting this because of your Premium trial. <a href="${siteUrl()}/settings.html#privacy" style="color:#2563EB;">Unsubscribe from tips and offers</a> (we'll still email essential account notices).</p>`
    : `<p style="color:#9CA3AF;font-size:12px;margin-top:24px;">HanVerse · Premium trial · no payment card required, nothing auto-renews.</p>`;
  return `<!doctype html><html><body style="margin:0;background:#FFF7ED;font-family:'Nunito',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">
<div style="font-size:28px;">🐼</div>
<h1 style="color:#1F2937;font-size:22px;margin:8px 0 16px;">${esc(title)}</h1>
<div style="color:#374151;font-size:15px;line-height:1.7;">${bodyHtml}</div>
${unsub}
</div></body></html>`;
}

/* The configured journey. day = offset from trial start (trial is 7 days). */
export const TRIAL_EMAIL_SCHEDULE = [
  { key: 'day0_welcome', day: 0, windowDays: 2, promotional: false },
  { key: 'day2_explore', day: 2, windowDays: 2, promotional: true },
  { key: 'day5_ending_soon', day: 5, windowDays: 1, promotional: true },
  { key: 'day6_last_day', day: 6, windowDays: 1, promotional: true },
  { key: 'day7_ended', day: 7, windowDays: 2, promotional: false },
  { key: 'day9_followup', day: 9, windowDays: 5, promotional: true }
];

function fmt(d) { return new Date(d).toISOString().slice(0, 10); }

/* Email bodies — honest copy, plan names and prices match the pricing table. */
export function buildTrialEmail(key, user = {}, now = new Date()) {
  const name = user.full_name || user.username || 'Learner';
  const upgrade = `<p><a href="${siteUrl()}/payment.html" style="display:inline-block;margin-top:8px;padding:12px 24px;background:#2563EB;color:#fff;border-radius:12px;text-decoration:none;font-weight:700;">See plans</a></p>
<p style="color:#6B7280;font-size:13px;">YCT Course · $4/month — every YCT 1–4 lesson and video. Premium · $10/month — everything plus worksheets and the member badge.</p>`;
  const map = {
    day0_welcome: () => ({
      subject: 'Your 7 days of Premium start now 🐼',
      html: shell('Welcome to HanVerse Premium', `<p>Hi ${esc(name)},</p>
<p>Your free 7-day Premium trial is active. Here is what that means:</p>
<ul><li><strong>Everything unlocked</strong> — all YCT 1–4 lessons, all videos, all premium worksheets.</li>
<li><strong>No payment card required</strong> — you never gave us one.</li>
<li><strong>Nothing auto-renews</strong> — when 7 days are over, you simply return to the free plan.</li>
<li><strong>Ends ${fmt(new Date(now.getTime() + 7 * DAY_MS))}</strong> — we'll remind you before it does.</li></ul>
<p>Your XP, streaks, achievements and words are yours to keep either way.</p>`),
      promotional: false
    }),
    day2_explore: () => ({
      subject: 'Three Premium things to try this week 🎬',
      html: shell('Discover your Premium features', `<p>Hi ${esc(name)},</p>
<p>Five days of Premium left. Three things worth trying:</p>
<ul><li><strong>Video lessons</strong> — watch tones and characters in action.</li>
<li><strong>Premium worksheets</strong> — print and practise offline.</li>
<li><strong>Tone Coach</strong> — it now drills your weakest tones first.</li></ul>${upgrade}`, { promotional: true }),
      promotional: true
    }),
    day5_ending_soon: () => ({
      subject: 'Two days left in your Premium trial ⏳',
      html: shell('Your trial ends in two days', `<p>Hi ${esc(name)},</p>
<p>Your free Premium trial ends in two days — no card on file, so nothing will be charged. If you'd like to keep every lesson, video and worksheet, here are the options:</p>${upgrade}`, { promotional: true }),
      promotional: true
    }),
    day6_last_day: () => ({
      subject: 'Your Premium trial ends tomorrow ⏰',
      html: shell('Trial ends tomorrow', `<p>Hi ${esc(name)},</p>
<p>Tomorrow your trial returns you to the <strong>free plan</strong>:</p>
<ul><li><strong>Kept forever:</strong> XP, streaks, achievements, vocabulary, lesson progress.</li>
<li><strong>Free plan:</strong> the first lessons of each YCT level, games, and daily missions.</li>
<li><strong>YCT Course ($4/mo):</strong> every YCT 1–4 lesson and video.</li>
<li><strong>Premium ($10/mo):</strong> everything, plus premium worksheets and the member badge.</li></ul>${upgrade}`, { promotional: true }),
      promotional: true
    }),
    day7_ended: () => ({
      subject: 'Your Premium trial has ended — your progress is safe 🐼',
      html: shell('Trial completed — thank you!', `<p>Hi ${esc(name)},</p>
<p>Your 7-day Premium trial has ended and your account is now on the <strong>free plan</strong>. Nothing was charged — there was never a card.</p>
<p>Everything you earned stays: XP, streaks, achievements, vocabulary and every completed lesson.</p>
<p>If you'd like to continue with all lessons, videos and worksheets, the YCT Course is $4/month and Premium is $10/month.</p>${upgrade}`),
      promotional: false
    }),
    day9_followup: () => ({
      subject: `Keep going, ${esc(name)} — your lessons are waiting 🐼`,
      html: shell('Still thinking about it?', `<p>Hi ${esc(name)},</p>
<p>No pressure — the free plan keeps your streak, XP and first lessons of every level going. Whenever you're ready, the YCT Course ($4/month) unlocks all YCT 1–4 lessons and Premium ($10/month) adds worksheets and the member badge.</p>
<p>熊猫陪着你。 The panda is with you.</p>${upgrade}`, { promotional: true }),
      promotional: true
    })
  };
  const built = map[key];
  if (!built) throw new Error(`Unknown trial email key: ${key}`);
  return built();
}

/* Pure scheduler core: which configured emails are due for this user?
 * @param user        row: trial_used, trial_ends_at, membership_plan,
 *                    membership_status, premium, premium_until,
 *                    is_banned, is_verified, marketing_unsubscribed
 * @param sentKeys    keys already delivered for this user
 * @param now         Date
 * @returns array of schedule entries to send now                      */
export function emailsDueForUser(user, sentKeys = [], now = new Date()) {
  if (!user || user.trial_used !== true || !user.trial_ends_at) return [];
  if (user.is_banned === true || user.is_verified !== true) return [];

  const trialEnd = new Date(user.trial_ends_at);
  if (Number.isNaN(trialEnd.getTime())) return [];

  // Upgraded to a paid plan? Thank-you/reminder sequence stops entirely.
  const ent = computeEntitlement({
    membership_plan: user.membership_plan, membership_status: user.membership_status,
    premium: user.premium, premium_until: user.premium_until,
    trial_used: false // ignore the trial itself when deciding "upgraded"
  }, now);
  const upgraded = ent.source === 'membership' && ent.active === true;
  if (upgraded) return [];

  const trialStart = trialEnd.getTime() - TRIAL_DAYS * DAY_MS;
  const sent = new Set(sentKeys);

  return TRIAL_EMAIL_SCHEDULE.filter(e => {
    if (sent.has(e.key)) return false;
    const from = trialStart + e.day * DAY_MS;
    const to = from + e.windowDays * DAY_MS;
    if (now < from || now >= to) return false;
    // end-of-trial emails only after the trial actually ended
    if ((e.key === 'day7_ended' || e.key === 'day9_followup') && trialEnd > now) return false;
    // early emails only while the trial window still makes sense
    if (e.key === 'day0_welcome' && now > trialEnd) return false;
    // opted out of marketing → only transactional notices remain
    if (e.promotional && user.marketing_unsubscribed === true) return false;
    return true;
  });
}

/* Ensure the log table + opt-out column exist (idempotent). */
export async function ensureTrialEmailSchema(pool) {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_unsubscribed BOOLEAN DEFAULT FALSE`);
  await pool.query(`CREATE TABLE IF NOT EXISTS trial_email_log (
    user_id INTEGER NOT NULL,
    email_key TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, email_key)
  )`);
}

/* Runner — safe to call from boot sweep, admin route or scheduled fn.
 * @param send  async ({to, subject, html}) => {success} — injected.   */
export async function runTrialEmailSweep({ pool, send, now = new Date(), dryRun = false, limit = 200 }) {
  await ensureTrialEmailSchema(pool);
  const candidates = await pool.query(
    `SELECT user_id, email, username, full_name, trial_used, trial_ends_at,
            membership_plan, membership_status, premium, premium_until,
            is_banned, is_verified, marketing_unsubscribed
     FROM users
     WHERE trial_used = TRUE AND trial_ends_at IS NOT NULL
       AND COALESCE(is_banned, FALSE) = FALSE
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit]
  );

  const sent = [], skipped = { upgraded: 0, optedOut: 0, notVerified: 0, noneDue: 0 }, failed = [];

  for (const user of candidates.rows) {
    const log = await pool.query(`SELECT email_key FROM trial_email_log WHERE user_id = $1`, [user.user_id]);
    const due = emailsDueForUser(user, log.rows.map(r => r.email_key), now);
    if (!due.length) {
      const ent = computeEntitlement({ membership_plan: user.membership_plan, membership_status: user.membership_status, premium: user.premium, premium_until: user.premium_until, trial_used: false }, now);
      if (ent.source === 'membership' && ent.active) skipped.upgraded++;
      else if (user.is_verified !== true) skipped.notVerified++;
      else skipped.noneDue++;
      continue;
    }
    if (user.marketing_unsubscribed === true && due.every(e => e.promotional)) { skipped.optedOut++; continue; }
    for (const entry of due) {
      if (dryRun) { sent.push({ user_id: user.user_id, key: entry.key, dryRun: true }); continue; }
      // Claim before sending: UNIQUE(user_id, email_key) prevents doubles.
      const claim = await pool.query(
        `INSERT INTO trial_email_log (user_id, email_key) VALUES ($1, $2)
         ON CONFLICT (user_id, email_key) DO NOTHING RETURNING email_key`,
        [user.user_id, entry.key]
      );
      if (!claim.rows.length) continue; // already sent by another run
      const mail = buildTrialEmail(entry.key, user, now);
      try {
        const result = await send({ to: user.email, subject: mail.subject, html: mail.html });
        if (result && result.success) sent.push({ user_id: user.user_id, key: entry.key });
        else throw new Error(result && result.error ? result.error : 'send failed');
      } catch (e) {
        // Release the claim so a later run retries this email.
        await pool.query(`DELETE FROM trial_email_log WHERE user_id = $1 AND email_key = $2`, [user.user_id, entry.key]);
        failed.push({ user_id: user.user_id, key: entry.key, error: e.message });
      }
    }
  }
  return { checked: candidates.rows.length, sent: sent.length, details: sent, skipped, failed: failed.length, failures: failed };
}

/* Real mailer using the same Brevo relay as server.js sendEmail(). */
export function createMailer() {
  if (!process.env.BREVO_SMTP_KEY) return null;
  const t = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com', port: 587, secure: false,
    auth: { user: '91f82d001@smtp-brevo.com', pass: process.env.BREVO_SMTP_KEY },
    tls: { rejectUnauthorized: true }
  });
  return async ({ to, subject, html, text = null }) => {
    try { await t.sendMail({ from: process.env.EMAIL_FROM, to, subject, html, text: text || undefined }); return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  };
}
