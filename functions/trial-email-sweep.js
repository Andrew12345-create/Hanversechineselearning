/* =========================================================
   NETLIFY SCHEDULED FUNCTION — trial email journey 📧
   Runs daily; sends the due Day 0/2/5/6/7/9 trial emails.
   Idempotent: trial_email_log UNIQUE(user_id, email_key)
   claims each send, so overlapping runs never double-send.
   Stops for upgraded, banned, unverified, deleted and
   opted-out users (see functions/trial-emails.js).
   Configured via `export const config` (Netlify v2 runtime).
   Requires: DATABASE_URL, BREVO_SMTP_KEY, EMAIL_FROM.
   ========================================================= */
import pg from 'pg';
import { runTrialEmailSweep, createMailer } from './trial-emails.js';

export const config = {
  schedule: '@daily'
};

export default async () => {
  const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    console.error('📧 trial-email-sweep: no DATABASE_URL configured');
    return new Response(JSON.stringify({ success: false, error: 'no database url' }), { status: 500 });
  }
  const send = createMailer();
  if (!send) {
    console.error('📧 trial-email-sweep: BREVO_SMTP_KEY not configured — skipping run');
    return new Response(JSON.stringify({ success: false, error: 'no mailer configured' }), { status: 200 });
  }

  const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: true } });
  try {
    const summary = await runTrialEmailSweep({ pool, send });
    console.log(`📧 trial-email-sweep: sent ${summary.sent}, failed ${summary.failed}, checked ${summary.checked}`);
    return new Response(JSON.stringify({ success: true, ...summary }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error('📧 trial-email-sweep failed:', e.message);
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
  } finally {
    await pool.end();
  }
};
