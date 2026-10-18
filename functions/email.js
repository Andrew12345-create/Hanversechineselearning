/* =========================================================
   HANVERSE EMAIL MODULE ✉️
   Shared mailer used by the feature pack (parent weekly
   digest). Mirrors the Brevo SMTP transport configured in
   server.js so behaviour is identical.
   Usage:  const { sendEmail } = await import('./email.js');
   ========================================================= */
import nodemailer from 'nodemailer';

const EMAIL_FROM = process.env.EMAIL_FROM || '"HanVerse" <andrewmunamwangi@gmail.com>';

let mailer = null;
let mailerTried = false;

function getMailer() {
  if (mailerTried) return mailer;
  mailerTried = true;
  try {
    if (!process.env.BREVO_SMTP_KEY) {
      console.warn('⚠️ email.js: BREVO_SMTP_KEY not set — email sending disabled');
      return null;
    }
    mailer = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.BREVO_SMTP_USER || '91f82d001@smtp-brevo.com',
        pass: process.env.BREVO_SMTP_KEY
      },
      tls: { rejectUnauthorized: false }
    });
  } catch (error) {
    console.error('❌ email.js: failed to create mailer:', error.message);
    mailer = null;
  }
  return mailer;
}

export async function sendEmail({ to, subject, html, text = null }) {
  const transport = getMailer();
  if (!transport) {
    console.warn('⚠️ email.js: mailer not available, skipping email send');
    return { success: false, error: 'Mailer not available' };
  }
  if (!to) {
    console.warn('⚠️ email.js: no recipient specified');
    return { success: false, error: 'No recipient specified' };
  }
  try {
    // Every email carries a notice + unsubscribe/footer link (compliance).
    const footer = `
      <div style="margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:11px;color:#6b7280;font-family:Arial,sans-serif">
        You received this email because you have a Hanverse account.
        <a href="${process.env.PUBLIC_SITE_URL || ''}/settings.html" style="color:#2563EB">Unsubscribe or manage emails</a> ·
        <a href="${process.env.PUBLIC_SITE_URL || ''}/privacy.html" style="color:#2563EB">Privacy Policy</a><br>
        [Your business name], [address]
      </div>`;
    const result = await transport.sendMail({
      from: EMAIL_FROM,
      to,
      subject,
      html: html + footer,
      text: text || undefined
    });
    console.log(`✅ email.js: email sent to ${to}`);
    return { success: true, result };
  } catch (error) {
    console.error(`❌ email.js: send failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}

export default { sendEmail };
