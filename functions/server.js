import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import dotenv from 'dotenv';
import serverless from 'serverless-http';
import OpenAI from 'openai';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const { Pool } = pkg;

/* ==========================================
   APP / ROUTER CONFIGURATION ⚙️
========================================== */
const app = express();
const router = express.Router();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/* ==========================================
   ENV / STARTUP DIAGNOSTICS LOGS 🔍
========================================== */
console.log('✅ OpenAI key exists:', !!process.env.OPENAI_API_KEY);
console.log('✅ Brevo key exists:', !!process.env.BREVO_SMTP_KEY);
console.log('✅ Database URL exists:', !!(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL));

/* ==========================================
   DATABASE SERVICES CONFIGURATION 🗄️
========================================== */
function normalizeDatabaseUrl(rawUrl) {
  if (!rawUrl) return null;
  let url = rawUrl.trim();
  url = url.replace(/^psql\s+/i, '');
  url = url.replace(/^['"]|['"]$/g, '');
  return url;
}

const databaseUrl = normalizeDatabaseUrl(
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL
);

let pool = null;

if (databaseUrl) {
  try {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: {
        rejectUnauthorized: false
      }
    });

    pool.query('SELECT 1')
      .then(() => {
        console.log('✅ Database connected');
      })
      .catch((error) => {
        console.error('❌ Database connection failed:', error.message);
      });

  } catch (error) {
    console.error('❌ Failed creating DB pool:', error.message);
  }
} else {
  console.error('❌ DATABASE_URL / NEON_DATABASE_URL missing');
}

/* ==========================================
   EMAIL CARRIER TRANSPORT CONFIG ✉️
========================================== */
const EMAIL_FROM = process.env.EMAIL_FROM || '"HanVerse" <andrewmunamwangi@gmail.com>';

let mailer = null;

try {
  mailer = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: '91f82d001@smtp-brevo.com',
      pass: process.env.BREVO_SMTP_KEY
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  mailer.verify((error) => {
    if (error) {
      console.error('❌ SMTP Error:', error.message);
    } else {
      console.log('✅ SMTP Ready');
    }
  });
} catch (error) {
  console.error('❌ Failed to create mailer:', error.message);
}

/* ==========================================
   UTILITY HELPERS 🔧
========================================== */
function dbUnavailable(res) {
  return res.status(500).json({
    success: false,
    error: 'Database unavailable'
  });
}

function ensurePool(res) {
  if (!pool) {
    dbUnavailable(res);
    return false;
  }
  return true;
}

function safeUser(user) {
  return {
    user_id: user.user_id,
    id: user.user_id,
    username: user.username,
    full_name: user.full_name,
    fullName: user.full_name,
    email: user.email,
    xp: user.xp || 0,
    level: user.level || 1,
    streak_days: user.streak_days || 0,
    streakDays: user.streak_days || 0,
    profile_picture: user.profile_picture || null,
    profilePicture: user.profile_picture || null,
    is_admin: user.is_admin || false,
    isAdmin: user.is_admin || false,
    is_banned: user.is_banned || false,
    isBanned: user.is_banned || false,
    banned_reason: user.banned_reason || null,
    is_verified: user.is_verified || false,
    isVerified: user.is_verified || false,
    premium: user.premium || false,
    is_premium: user.premium || false,
    isPremium: user.premium || false,
    premium_until: user.premium_until || null,
    current_yct: user.current_yct || 1,
    current_hsk: user.current_hsk || 0,
    chinese_level: user.chinese_level || "YCT 1",
    role: user.role || 'student',
    lessons_completed: user.lessons_completed || 0,
    achievements_count: user.achievements_count || 0
  };
}

function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

function getFrontendBaseUrl() {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL.replace(/\/$/, '');
  if (process.env.URL) return process.env.URL.replace(/\/$/, '');
  return 'https://hanverse.netlify.app';
}

/* ==========================================
   EMAIL TEMPLATES 🐼
========================================== */
function getVerificationEmailHTML({ username, fullName, verifyLink, logoUrl }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your HanVerse Email</title>
      <style>
        body {
          font-family: 'Poppins', Arial, sans-serif;
          background: #0F172A;
          color: #E8E8F0;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 560px;
          margin: 40px auto;
          background: linear-gradient(145deg, #1E293B, #0F172A);
          border-radius: 24px;
          padding: 48px 40px;
          border: 1px solid rgba(255,255,255,0.06);
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        .header {
          text-align: center;
          margin-bottom: 32px;
        }
        .logo-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 8px;
        }
        .logo {
          font-size: 42px;
        }
        .brand {
          font-size: 28px;
          font-weight: 800;
          background: linear-gradient(135deg, #60A5FA, #34D399);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .panda-icon {
          font-size: 36px;
        }
        .title {
          font-size: 26px;
          font-weight: 700;
          color: #FFFFFF;
          text-align: center;
          margin: 20px 0 12px;
        }
        .subtitle {
          color: #94A3B8;
          text-align: center;
          line-height: 1.7;
          font-size: 15px;
          margin-bottom: 28px;
        }
        .subtitle strong {
          color: #F1F5F9;
        }
        .button-container {
          text-align: center;
          margin: 32px 0;
        }
        .button {
          display: inline-block;
          padding: 16px 44px;
          background: linear-gradient(135deg, #3B82F6, #14B8A6);
          color: white;
          text-decoration: none;
          border-radius: 12px;
          font-weight: 600;
          font-size: 16px;
          transition: transform 0.2s, box-shadow 0.2s;
          box-shadow: 0 4px 20px rgba(59, 130, 246, 0.3);
        }
        .button:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 30px rgba(59, 130, 246, 0.4);
        }
        .divider {
          border: none;
          height: 1px;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.08), transparent);
          margin: 28px 0;
        }
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          background: rgba(255,255,255,0.03);
          border-radius: 12px;
          padding: 16px 20px;
          margin: 16px 0;
        }
        .info-item {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #94A3B8;
          font-size: 13px;
        }
        .info-item span {
          color: #F1F5F9;
        }
        .expiry {
          text-align: center;
          color: #64748B;
          font-size: 13px;
          margin-top: 16px;
        }
        .expiry strong {
          color: #F59E0B;
        }
        .footer {
          text-align: center;
          color: #64748B;
          font-size: 13px;
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid rgba(255,255,255,0.06);
          line-height: 1.8;
        }
        .footer a {
          color: #60A5FA;
          text-decoration: none;
        }
        .footer a:hover {
          text-decoration: underline;
        }
        .features {
          display: flex;
          justify-content: center;
          gap: 24px;
          margin: 12px 0 8px;
          flex-wrap: wrap;
        }
        .features span {
          color: #64748B;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .features span::before {
          content: "✓";
          color: #34D399;
          font-weight: 700;
        }
        @media (max-width: 480px) {
          .container { padding: 28px 20px; }
          .title { font-size: 22px; }
          .button { padding: 14px 32px; font-size: 14px; }
          .info-grid { grid-template-columns: 1fr; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-wrapper">
            <span class="logo">🐼</span>
            <span class="brand">HanVerse</span>
          </div>
        </div>

        <div class="title">✨ Welcome to HanVerse, ${fullName || username || 'Parent'}!</div>

        <div class="subtitle">
          You're one step away from unlocking a world of Mandarin learning.<br>
          <strong>Verify your email</strong> to get full access to stories, games, and AI tutoring.
        </div>

        <div class="button-container">
          <a href="${verifyLink}" class="button">✅ Verify My Email</a>
        </div>

        <div class="expiry">
          ⏰ This link expires in <strong>24 hours</strong>
        </div>

        <hr class="divider">

        <div class="info-grid">
          <div class="info-item">📧 <span>${username || 'Your username'}</span></div>
          <div class="info-item">📚 <span>YCT 1 - 4</span></div>
          <div class="info-item">🎮 <span>30+ Games</span></div>
          <div class="info-item">🤖 <span>AI Tutor</span></div>
        </div>

        <div class="features">
          <span>Interactive Stories</span>
          <span>AI Tutor</span>
          <span>Progress Tracking</span>
        </div>

        <div class="footer">
          <p>If you didn't create a HanVerse account, you can safely ignore this email.</p>
          <p>Need help? <a href="mailto:support@hanverse.com">support@hanverse.com</a></p>
          <p style="margin-top: 8px; font-size: 12px; color: #475569;">
            🐼 HanVerse — Learn Mandarin Through Stories, Games & AI
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function getPasswordResetEmailHTML({ username, fullName, resetLink }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your HanVerse Password</title>
      <style>
        body {
          font-family: 'Poppins', Arial, sans-serif;
          background: #0F172A;
          color: #E8E8F0;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 560px;
          margin: 40px auto;
          background: linear-gradient(145deg, #1E293B, #0F172A);
          border-radius: 24px;
          padding: 48px 40px;
          border: 1px solid rgba(255,255,255,0.06);
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        .header {
          text-align: center;
          margin-bottom: 32px;
        }
        .logo-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 8px;
        }
        .brand {
          font-size: 28px;
          font-weight: 800;
          background: linear-gradient(135deg, #60A5FA, #34D399);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .title {
          font-size: 26px;
          font-weight: 700;
          color: #FFFFFF;
          text-align: center;
          margin: 20px 0 12px;
        }
        .subtitle {
          color: #94A3B8;
          text-align: center;
          line-height: 1.7;
          font-size: 15px;
          margin-bottom: 28px;
        }
        .subtitle strong {
          color: #F1F5F9;
        }
        .button-container {
          text-align: center;
          margin: 32px 0;
        }
        .button {
          display: inline-block;
          padding: 16px 44px;
          background: linear-gradient(135deg, #F59E0B, #D97706);
          color: white;
          text-decoration: none;
          border-radius: 12px;
          font-weight: 600;
          font-size: 16px;
          transition: transform 0.2s, box-shadow 0.2s;
          box-shadow: 0 4px 20px rgba(245, 158, 11, 0.3);
        }
        .button:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 30px rgba(245, 158, 11, 0.4);
        }
        .divider {
          border: none;
          height: 1px;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.08), transparent);
          margin: 28px 0;
        }
        .expiry {
          text-align: center;
          color: #64748B;
          font-size: 13px;
          margin-top: 16px;
        }
        .expiry strong {
          color: #F59E0B;
        }
        .footer {
          text-align: center;
          color: #64748B;
          font-size: 13px;
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid rgba(255,255,255,0.06);
          line-height: 1.8;
        }
        .footer a {
          color: #60A5FA;
          text-decoration: none;
        }
        .security-note {
          background: rgba(239, 68, 68, 0.08);
          border-radius: 12px;
          padding: 16px 20px;
          margin: 16px 0;
          border-left: 3px solid #EF4444;
          color: #94A3B8;
          font-size: 14px;
          line-height: 1.6;
        }
        .security-note strong {
          color: #FCA5A5;
        }
        @media (max-width: 480px) {
          .container { padding: 28px 20px; }
          .title { font-size: 22px; }
          .button { padding: 14px 32px; font-size: 14px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-wrapper">
            <span style="font-size: 42px;">🐼</span>
            <span class="brand">HanVerse</span>
          </div>
        </div>

        <div class="title">🔒 Reset Your Password</div>

        <div class="subtitle">
          Hi <strong>${fullName || username || 'Learner'}</strong>,<br>
          We received a request to reset your HanVerse password.
        </div>

        <div class="button-container">
          <a href="${resetLink}" class="button">🔄 Reset Password</a>
        </div>

        <div class="expiry">
          ⏰ This link expires in <strong>1 hour</strong>
        </div>

        <div class="security-note">
          <strong>🔐 Security Notice:</strong> If you didn't request this password reset, you can safely ignore this email. Your account remains secure.
        </div>

        <hr class="divider">

        <div class="footer">
          <p>Need help? <a href="mailto:support@hanverse.com">support@hanverse.com</a></p>
          <p style="margin-top: 8px; font-size: 12px; color: #475569;">
            🐼 HanVerse — Learn Mandarin Through Stories, Games & AI
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ==========================================
// WELCOME EMAIL TEMPLATE 🎉
// ==========================================
function getWelcomeEmailHTML({ username, fullName }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to HanVerse! 🐼</title>
      <style>
        body {
          font-family: 'Poppins', Arial, sans-serif;
          background: #0F172A;
          color: #E8E8F0;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 560px;
          margin: 40px auto;
          background: linear-gradient(145deg, #1E293B, #0F172A);
          border-radius: 24px;
          padding: 48px 40px;
          border: 1px solid rgba(255,255,255,0.06);
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        .header {
          text-align: center;
          margin-bottom: 32px;
        }
        .logo-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 8px;
        }
        .logo {
          font-size: 42px;
        }
        .brand {
          font-size: 28px;
          font-weight: 800;
          background: linear-gradient(135deg, #60A5FA, #34D399);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .title {
          font-size: 26px;
          font-weight: 700;
          color: #FFFFFF;
          text-align: center;
          margin: 20px 0 12px;
        }
        .subtitle {
          color: #94A3B8;
          text-align: center;
          line-height: 1.7;
          font-size: 15px;
          margin-bottom: 28px;
        }
        .subtitle strong {
          color: #F1F5F9;
        }
        .features-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin: 24px 0;
        }
        .feature-card {
          background: rgba(255,255,255,0.03);
          border-radius: 12px;
          padding: 16px;
          text-align: center;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .feature-icon {
          font-size: 28px;
          display: block;
          margin-bottom: 8px;
        }
        .feature-name {
          color: #F1F5F9;
          font-weight: 600;
          font-size: 14px;
          display: block;
        }
        .feature-desc {
          color: #94A3B8;
          font-size: 12px;
          display: block;
          margin-top: 4px;
        }
        .button-container {
          text-align: center;
          margin: 32px 0;
        }
        .button {
          display: inline-block;
          padding: 16px 44px;
          background: linear-gradient(135deg, #3B82F6, #14B8A6);
          color: white;
          text-decoration: none;
          border-radius: 12px;
          font-weight: 600;
          font-size: 16px;
          transition: transform 0.2s, box-shadow 0.2s;
          box-shadow: 0 4px 20px rgba(59, 130, 246, 0.3);
        }
        .button:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 30px rgba(59, 130, 246, 0.4);
        }
        .divider {
          border: none;
          height: 1px;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.08), transparent);
          margin: 28px 0;
        }
        .get-started {
          background: rgba(255,255,255,0.03);
          border-radius: 12px;
          padding: 20px;
          margin: 16px 0;
        }
        .get-started h4 {
          color: #F1F5F9;
          margin: 0 0 12px 0;
          font-size: 16px;
        }
        .get-started ol {
          color: #94A3B8;
          margin: 0;
          padding-left: 20px;
          font-size: 14px;
          line-height: 1.8;
        }
        .get-started ol li {
          margin-bottom: 4px;
        }
        .footer {
          text-align: center;
          color: #64748B;
          font-size: 13px;
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid rgba(255,255,255,0.06);
          line-height: 1.8;
        }
        .footer a {
          color: #60A5FA;
          text-decoration: none;
        }
        .footer a:hover {
          text-decoration: underline;
        }
        .social-links {
          display: flex;
          justify-content: center;
          gap: 16px;
          margin: 12px 0;
        }
        .social-links span {
          color: #64748B;
          font-size: 20px;
        }
        @media (max-width: 480px) {
          .container { padding: 28px 20px; }
          .title { font-size: 22px; }
          .button { padding: 14px 32px; font-size: 14px; }
          .features-grid { grid-template-columns: 1fr; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-wrapper">
            <span class="logo">🐼</span>
            <span class="brand">HanVerse</span>
          </div>
        </div>

        <div class="title">🎉 Welcome to HanVerse, ${fullName || username || 'Learner'}!</div>

        <div class="subtitle">
          You've joined a magical world where learning Mandarin is fun and easy!<br>
          <strong>Let's get started on your language adventure! 🚀</strong>
        </div>

        <div class="features-grid">
          <div class="feature-card">
            <span class="feature-icon">📚</span>
            <span class="feature-name">Interactive Stories</span>
            <span class="feature-desc">Learn through engaging stories</span>
          </div>
          <div class="feature-card">
            <span class="feature-icon">🎮</span>
            <span class="feature-name">Fun Games</span>
            <span class="feature-desc">Play and learn at the same time</span>
          </div>
          <div class="feature-card">
            <span class="feature-icon">🤖</span>
            <span class="feature-name">AI Panda Tutor</span>
            <span class="feature-desc">Your personal Mandarin assistant</span>
          </div>
          <div class="feature-card">
            <span class="feature-icon">🏆</span>
            <span class="feature-name">Achievements</span>
            <span class="feature-desc">Earn rewards as you progress</span>
          </div>
        </div>

        <div class="get-started">
          <h4>🌟 Your First Steps:</h4>
          <ol>
            <li>Complete your profile and set your learning goals</li>
            <li>Take a placement test to find your perfect starting level</li>
            <li>Start your first lesson and earn XP points!</li>
            <li>Chat with Panda AI whenever you need help</li>
          </ol>
        </div>

        <div class="button-container">
          <a href="${getFrontendBaseUrl()}/dashboard.html" class="button">🚀 Start Learning Now</a>
        </div>

        <hr class="divider">

        <div style="text-align: center; color: #94A3B8; font-size: 14px; margin: 16px 0;">
          <p style="margin: 4px 0;">🎯 Complete your first lesson today and earn 50 bonus XP!</p>
          <p style="margin: 4px 0; font-size: 13px; color: #64748B;">👆 Click the button above to begin</p>
        </div>

        <div class="footer">
          <p>Have questions? We're here to help! <a href="mailto:support@hanverse.com">support@hanverse.com</a></p>
          <div class="social-links">
            <span>🐼</span>
            <span>🎋</span>
            <span>🏮</span>
            <span>🎐</span>
          </div>
          <p style="margin-top: 8px; font-size: 12px; color: #475569;">
            🐼 HanVerse — Learn Mandarin Through Stories, Games & AI
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/* ==========================================
   EMAIL SEND FUNCTIONS
========================================== */
async function sendVerificationEmail({ to, username, fullName, token }) {
  const baseUrl = getFrontendBaseUrl();
  
const verifyLink = `${baseUrl}/verify-email.html?token=${token}&email=${encodeURIComponent(to)}`;
 const html = getVerificationEmailHTML({
    username,
    fullName: fullName || username,
    verifyLink
  });

  if (mailer) {
    await mailer.sendMail({
      from: EMAIL_FROM,
      to,
      subject: '🐼 Welcome to HanVerse! Verify Your Email',
      html
    });
    console.log(`✅ Verification email sent to ${to}`);
  } else {
    console.warn('⚠️ Mailer not available, skipping email send');
  }
}
// ==========================================
// SEND WELCOME EMAIL
// ==========================================
async function sendWelcomeEmail({ to, username, fullName }) {
  const html = getWelcomeEmailHTML({
    username,
    fullName: fullName || username
  });

  if (mailer) {
    await mailer.sendMail({
      from: EMAIL_FROM,
      to,
      subject: '🎉 Welcome to HanVerse! Your Mandarin Adventure Begins!',
      html
    });
    console.log(`✅ Welcome email sent to ${to}`);
  } else {
    console.warn('⚠️ Mailer not available, skipping welcome email');
  }
}

async function sendPasswordResetEmail({ to, username, fullName, token }) {
  const baseUrl = getFrontendBaseUrl();
  const resetLink = `${baseUrl}/reset-password.html?token=${token}`;

  const html = getPasswordResetEmailHTML({
    username,
    fullName: fullName || username,
    resetLink
  });

  if (mailer) {
    await mailer.sendMail({
      from: EMAIL_FROM,
      to,
      subject: '🔒 Reset Your HanVerse Password',
      html
    });
    console.log(`✅ Password reset email sent to ${to}`);
  } else {
    console.warn('⚠️ Mailer not available, skipping email send');
  }
}

/* ==========================================
   MIDDLEWARE: Admin Auth Check
========================================== */
async function verifyAdminToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing or invalid security token.' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, error: 'Invalid token format.' });
    }

    req.adminToken = token;
    next();
  } catch (error) {
    console.error('❌ Admin auth error:', error);
    return res.status(500).json({ success: false, error: 'Authentication check failed.' });
  }
}

/* ==========================================
   AUTH ENDPOINTS 🔐
========================================== */

// ==========================================
// SIGNUP 🚀
// ==========================================
router.post('/signup', async (req, res) => {
  try {
    console.log('📥 Signup request received');
    
    if (!ensurePool(res)) return;

    const { username, full_name, email, password, role } = req.body || {};

    // --- VALIDATION ---
    if (!username || !full_name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username, full name, email, and password are required.'
      });
    }

    const cleanUsername = String(username).trim();
    const cleanFullName = String(full_name).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPassword = String(password);
    const userRole = role === 'parent' ? 'parent' : 'student';

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters.'
      });
    }

    if (cleanUsername.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters.'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid email address.'
      });
    }

    // --- CHECK EXISTING USER ---
    const existing = await pool.query(
      `SELECT user_id, email, username FROM users WHERE email = $1 OR username = $2`,
      [cleanEmail, cleanUsername]
    );

    if (existing.rows.length) {
      const conflict = existing.rows[0];
      if (conflict.email === cleanEmail) {
        return res.status(409).json({
          success: false,
          error: 'An account with that email already exists.',
          field: 'email'
        });
      }
      if (conflict.username === cleanUsername) {
        return res.status(409).json({
          success: false,
          error: 'That username is already taken.',
          field: 'username'
        });
      }
    }

    // --- CREATE USER ---
    const password_hash = await bcrypt.hash(cleanPassword, 10);
    const verificationToken = generateToken(24);

    let hasRoleColumn = false;
    try {
      const columnCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'role'
      `);
      hasRoleColumn = columnCheck.rows.length > 0;
    } catch (e) {
      console.warn('⚠️ Could not check for role column:', e.message);
    }

    let insertResult;
    if (hasRoleColumn) {
      insertResult = await pool.query(
        `INSERT INTO users (
          username, full_name, email, password_hash, xp, level, streak_days, 
          is_admin, is_banned, is_verified, premium, role, 
          lessons_completed, achievements_count, created_at
        ) VALUES ($1, $2, $3, $4, 0, 1, 0, false, false, false, false, $5, 0, 0, NOW())
        RETURNING *`,
        [cleanUsername, cleanFullName, cleanEmail, password_hash, userRole]
      );
    } else {
      insertResult = await pool.query(
        `INSERT INTO users (
          username, full_name, email, password_hash, xp, level, streak_days, 
          is_admin, is_banned, is_verified, premium, 
          lessons_completed, achievements_count, created_at
        ) VALUES ($1, $2, $3, $4, 0, 1, 0, false, false, false, false, 0, 0, NOW())
        RETURNING *`,
        [cleanUsername, cleanFullName, cleanEmail, password_hash]
      );
    }

    const newUser = insertResult.rows[0];
    console.log('✅ User created with ID:', newUser.user_id);

    // --- CREATE PARENT RECORD (if role is parent) ---
    if (userRole === 'parent') {
      try {
        const tableCheck = await pool.query(`
          SELECT table_name FROM information_schema.tables WHERE table_name = 'parents'
        `);
        
        if (tableCheck.rows.length > 0) {
          const existingParent = await pool.query(`
            SELECT * FROM parents WHERE user_id = $1
          `, [newUser.user_id]);
          
          if (existingParent.rows.length === 0) {
            await pool.query(`
              INSERT INTO parents (user_id, full_name, email, is_verified, created_at, updated_at)
              VALUES ($1, $2, $3, false, NOW(), NOW())
            `, [newUser.user_id, cleanFullName, cleanEmail]);
            console.log('✅ Parent record created for user:', newUser.user_id);
          }
        }
      } catch (parentError) {
        console.warn('⚠️ Could not create parent record:', parentError.message);
      }
    }
    
    // --- STORE VERIFICATION TOKEN ---
    try {
      await pool.query(
        `INSERT INTO email_verifications (user_id, token, created_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
        [newUser.user_id, verificationToken]
      );
      console.log('✅ Verification token stored');
    } catch (verificationInsertError) {
      console.warn("⚠️ Could not insert into email_verifications table:", verificationInsertError.message);
    }

   // --- SEND VERIFICATION EMAIL ---
try {
  await sendVerificationEmail({
    to: cleanEmail,
    username: cleanUsername,
    fullName: cleanFullName,
    token: verificationToken
  });
  console.log('✅ Verification email sent');
} catch (mailError) {
  console.warn("⚠️ Verification email could not be sent:", mailError.message);
}

// --- SEND WELCOME EMAIL (separate from verification) ---
try {
  await sendWelcomeEmail({
    to: cleanEmail,
    username: cleanUsername,
    fullName: cleanFullName
  });
  console.log('✅ Welcome email sent');
} catch (mailError) {
  console.warn("⚠️ Welcome email could not be sent:", mailError.message);
}

    return res.status(201).json({
      success: true,
      message: "Signup successful. Please check your email for verification.",
      user: safeUser(newUser)
    });

  } catch (error) {
    console.error('❌ Signup error:', error);
    return res.status(500).json({
      success: false,
      error: 'Signup failed. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==========================================
// LOGIN 🔑
// ==========================================
router.post('/login', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.'
      });
    }

    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1`,
      [email.trim().toLowerCase()]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.'
      });
    }

    const user = result.rows[0];

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.'
      });
    }

    if (user.is_banned) {
      return res.status(403).json({
        success: false,
        error: 'banned',
        reason: user.banned_reason || 'Account has been suspended.'
      });
    }

    if (!user.is_verified) {
      return res.status(403).json({
        success: false,
        error: 'not_verified',
        message: 'Please verify your email before logging in.'
      });
    }

    return res.json({
      success: true,
      user: safeUser(user)
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    return res.status(500).json({
      success: false,
      error: 'Login failed. Please try again.'
    });
  }
});

// ==========================================
// GET USER PROFILE
// ==========================================
router.get('/user/:userId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { userId } = req.params;

    const result = await pool.query(
      `SELECT user_id, username, full_name, email, xp, level, streak_days, 
              profile_picture, is_admin, is_banned, banned_reason, is_verified, 
              premium, premium_until, current_yct, current_hsk, chinese_level, role,
              lessons_completed, achievements_count
       FROM users WHERE user_id = $1`,
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'User not found.'
      });
    }

    const user = result.rows[0];
    
    return res.json({
      success: true,
      user: safeUser(user)
    });

  } catch (error) {
    console.error('❌ Profile error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile.'
    });
  }
});

// ==========================================
// SESSION REFRESH
// ==========================================
router.post('/auth/refresh', async (req, res) => {
  try {
    if (!ensurePool(res)) return;
    
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID required' });
    }
    
    const result = await pool.query(
      `SELECT user_id, username, full_name, email, xp, level, streak_days,
              profile_picture, is_admin, is_banned, is_verified,
              premium, premium_until, role, lessons_completed, achievements_count
       FROM users WHERE user_id = $1 AND is_banned = false`,
      [userId]
    );
    
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    return res.json({ 
      success: true, 
      user: safeUser(result.rows[0]) 
    });
  } catch (error) {
    console.error('❌ Session refresh error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to refresh session' 
    });
  }
});

// ==========================================
// LOGOUT
// ==========================================
router.post('/auth/logout', async (req, res) => {
  return res.json({ success: true, message: 'Logged out successfully' });
});

// ==========================================
// FIND USER BY EMAIL
// ==========================================
router.post('/auth/user-by-email', async (req, res) => {
  try {
    if (!ensurePool(res)) return;
    
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email required' });
    }
    
    const result = await pool.query(
      `SELECT user_id, username, full_name, email, is_verified, is_banned, role
       FROM users WHERE email = $1`,
      [email.trim().toLowerCase()]
    );
    
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    return res.json({ 
      success: true, 
      user: safeUser(result.rows[0]) 
    });
  } catch (error) {
    console.error('❌ User by email error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to find user' 
    });
  }
});

// ==========================================
// SEND VERIFICATION EMAIL
// ==========================================
router.post('/auth/send-verification', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { userId } = req.body || {};

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required.'
      });
    }

    const userResult = await pool.query(
      `SELECT user_id, email, username, full_name, is_verified 
       FROM users WHERE user_id = $1`,
      [userId]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'User not found.'
      });
    }

    const user = userResult.rows[0];

    if (user.is_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email is already verified.'
      });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS email_verifications (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          email VARCHAR(255) NOT NULL,
          token VARCHAR(64) NOT NULL UNIQUE,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
    } catch (tableError) {
      console.warn('⚠️ Could not create email_verifications table:', tableError.message);
    }

    await pool.query(
      `INSERT INTO email_verifications (user_id, email, token, expires_at, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE 
       SET token = $3, email = $2, expires_at = $4, created_at = NOW()`,
      [userId, user.email, verificationToken, expiresAt]
    );

    await sendVerificationEmail({
      to: user.email,
      username: user.username,
      fullName: user.full_name,
      token: verificationToken
    });

    return res.json({
      success: true,
      message: 'Verification email sent successfully.',
      email: user.email
    });

  } catch (error) {
    console.error('❌ Send verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send verification email. Please try again.'
    });
  }
});

// ==========================================
// RESEND VERIFICATION EMAIL
// ==========================================
router.post('/auth/resend-verification', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { userId } = req.body || {};

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required.'
      });
    }

    const userResult = await pool.query(
      `SELECT user_id, email, username, full_name, is_verified 
       FROM users WHERE user_id = $1`,
      [userId]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'User not found.'
      });
    }

    const user = userResult.rows[0];

    if (user.is_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email is already verified.'
      });
    }

    await pool.query(
      `DELETE FROM email_verifications WHERE user_id = $1`,
      [userId]
    );

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO email_verifications (user_id, email, token, expires_at, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [userId, user.email, verificationToken, expiresAt]
    );

    await sendVerificationEmail({
      to: user.email,
      username: user.username,
      fullName: user.full_name,
      token: verificationToken
    });

    return res.json({
      success: true,
      message: 'Verification email resent successfully.'
    });

  } catch (error) {
    console.error('❌ Resend verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to resend verification email.'
    });
  }
});

// ==========================================
// VERIFY EMAIL (GET - for link click)
// ==========================================
router.get('/verify-email', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { token, email } = req.query;

    if (!token || !email) {
      return res.redirect(`${getFrontendBaseUrl()}/login.html?verified=false&error=Missing+verification+parameters`);
    }

    const tokenResult = await pool.query(
      `SELECT user_id, email, expires_at 
       FROM email_verifications 
       WHERE token = $1 AND email = $2`,
      [token, email]
    );

    if (!tokenResult.rows.length) {
      return res.redirect(`${getFrontendBaseUrl()}/login.html?verified=false&error=Invalid+verification+link`);
    }

    const record = tokenResult.rows[0];

    if (new Date(record.expires_at) < new Date()) {
      return res.redirect(`${getFrontendBaseUrl()}/login.html?verified=false&error=Link+has+expired.+Please+request+a+new+one.`);
    }

    await pool.query(
      `UPDATE users 
       SET is_verified = true, 
           verified_at = NOW(),
           email_confirmed = true
       WHERE user_id = $1`,
      [record.user_id]
    );

    await pool.query(
      `DELETE FROM email_verifications WHERE token = $1`,
      [token]
    );

    console.log(`✅ Email verified for user ${record.user_id}`);

    return res.redirect(`${getFrontendBaseUrl()}/login.html?verified=true`);

  } catch (error) {
    console.error('❌ Verify email error:', error);
    return res.redirect(`${getFrontendBaseUrl()}/login.html?verified=false&error=System+error.+Please+try+again.`);
  }
});

// ==========================================
// VERIFY EMAIL (POST - for API)
// ==========================================
router.post('/verify-email', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { token } = req.body || {};

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Verification token is required.'
      });
    }

    const tokenResult = await pool.query(
      `SELECT user_id FROM email_verifications 
       WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );

    if (!tokenResult.rows.length) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification token.'
      });
    }

    const { user_id } = tokenResult.rows[0];

    await pool.query(
      `UPDATE users SET is_verified = true WHERE user_id = $1`,
      [user_id]
    );

    await pool.query(
      `DELETE FROM email_verifications WHERE token = $1`,
      [token]
    );

    return res.json({
      success: true,
      message: 'Email verified successfully.'
    });

  } catch (error) {
    console.error('❌ Verify email error:', error);
    return res.status(500).json({
      success: false,
      error: 'Email verification failed.'
    });
  }
});

// ==========================================
// CHECK VERIFICATION STATUS
// ==========================================
router.get('/auth/verification-status/:userId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required.'
      });
    }

    const result = await pool.query(
      `SELECT user_id, email, is_verified, verified_at, email_confirmed
       FROM users WHERE user_id = $1`,
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'User not found.'
      });
    }

    const user = result.rows[0];

    return res.json({
      success: true,
      isVerified: user.is_verified || false,
      email: user.email,
      verifiedAt: user.verified_at || null,
      emailConfirmed: user.email_confirmed || false
    });

  } catch (error) {
    console.error('❌ Verification status error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check verification status.'
    });
  }
});

// ==========================================
// FORGOT PASSWORD
// ==========================================
router.post('/forgot-password', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email address is required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const userResult = await pool.query(
      `SELECT user_id, username, full_name FROM users WHERE email = $1`,
      [cleanEmail]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ 
        success: false, 
        error: 'No account found with that email address.' 
      });
    }

    const user = userResult.rows[0];
    const resetToken = generateToken(32);

    try {
      await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [user.user_id]);
    } catch(e) {
      // Table might not exist
    }

    await pool.query(
      `INSERT INTO password_resets (user_id, token, created_at, expires_at)
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '1 hour')`,
      [user.user_id, resetToken]
    );

    await sendPasswordResetEmail({
      to: cleanEmail,
      username: user.username,
      fullName: user.full_name,
      token: resetToken
    });

    return res.json({
      success: true,
      message: 'Password reset link has been sent to your email address.'
    });

  } catch (error) {
    console.error('❌ Forgot password error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to process password reset request.' 
    });
  }
});

// ==========================================
// RESET PASSWORD
// ==========================================
router.post('/reset-password', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        error: 'Token and new password are required.' 
      });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({ 
        success: false, 
        error: 'The new password must contain at least 8 characters.' 
      });
    }

    const tokenResult = await pool.query(
      `SELECT user_id FROM password_resets WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );

    if (!tokenResult.rows.length) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid or expired password reset token.' 
      });
    }

    const { user_id } = tokenResult.rows[0];

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await pool.query(
      `UPDATE users SET password_hash = $1 WHERE user_id = $2`,
      [newHash, user_id]
    );

    await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [user_id]);

    return res.json({
      success: true,
      message: 'Password updated successfully.'
    });

  } catch (error) {
    console.error('❌ Reset password error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Password update failed.' 
    });
  }
});

// ==========================================
// PARENT PASSWORD VERIFICATION
// ==========================================
router.post('/verify-parent-password', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { parentId, password } = req.body || {};

    if (!parentId || !password) {
      return res.status(400).json({
        success: false,
        error: 'Parent ID and password are required.'
      });
    }

    const result = await pool.query(
      `SELECT user_id, password_hash, is_verified, is_banned 
       FROM users 
       WHERE user_id = $1 AND role = 'parent'`,
      [parentId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Parent account not found.'
      });
    }

    const parent = result.rows[0];

    if (!parent.is_verified) {
      return res.status(403).json({
        success: false,
        error: 'Parent account is not verified.'
      });
    }

    if (parent.is_banned) {
      return res.status(403).json({
        success: false,
        error: 'Parent account is banned.'
      });
    }

    const isValid = await bcrypt.compare(password, parent.password_hash);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid password. Please try again.'
      });
    }

    return res.json({
      success: true,
      message: 'Password verified successfully.',
      parent: {
        user_id: parent.user_id,
        is_verified: parent.is_verified,
        is_banned: parent.is_banned
      }
    });

  } catch (error) {
    console.error('❌ Parent password verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Verification failed. Please try again.'
    });
  }
});

/* ==========================================
   PARENT/CHILDREN ENDPOINTS 👪
========================================== */

// ==========================================
// GET ALL CHILDREN FOR A PARENT
// ==========================================
router.get('/parents/children/:parentId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { parentId } = req.params;

    const parentResult = await pool.query(
      `SELECT p.parent_id, u.is_verified, u.is_banned 
       FROM parents p
       JOIN users u ON p.user_id = u.user_id
       WHERE p.parent_id = $1 OR p.user_id = $1`,
      [parentId]
    );

    if (!parentResult.rows.length) {
      return res.status(404).json({ 
        success: false, 
        error: 'Parent not found.' 
      });
    }

    const parent = parentResult.rows[0];
    const parentRecordId = parent.parent_id;

    const childrenResult = await pool.query(`
      SELECT 
        child_id as id,
        user_id,
        full_name,
        age,
        level,
        xp,
        streak_days,
        lessons_completed,
        achievements_count,
        progress_percentage,
        is_active,
        is_banned,
        created_at,
        last_active,
        last_lesson_at,
        username,
        email
      FROM children
      WHERE parent_id = $1 AND is_active = true
      ORDER BY full_name
    `, [parentRecordId]);

    const children = childrenResult.rows.map(child => ({
      user_id: child.user_id,
      child_id: child.id,
      full_name: child.full_name || 'Child',
      age: child.age || null,
      level: child.level || 'YCT 1',
      xp: child.xp || 0,
      streak: child.streak_days || 0,
      lessons_completed: child.lessons_completed || 0,
      achievements: child.achievements_count || 0,
      progress: child.progress_percentage || 0,
      is_verified: true,
      is_banned: child.is_banned || false,
      is_active: child.is_active || true,
      username: child.username || '',
      email: child.email || '',
      created_at: child.created_at,
      last_active: child.last_active,
      last_lesson_at: child.last_lesson_at
    }));

    return res.json({
      success: true,
      children: children
    });

  } catch (error) {
    console.error('❌ Error fetching children:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch children data.'
    });
  }
});

// ==========================================
// GET SINGLE CHILD BY ID
// ==========================================
router.get('/parents/child/:childId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { childId } = req.params;
    const parentId = req.query.parentId || req.headers['x-parent-id'];

    if (!parentId) {
      return res.status(400).json({
        success: false,
        error: 'Parent ID is required.'
      });
    }

    const childResult = await pool.query(`
      SELECT 
        c.child_id,
        c.user_id,
        c.parent_id,
        c.full_name,
        c.age,
        c.level,
        c.xp,
        c.streak_days as streak,
        c.lessons_completed,
        c.achievements_count as achievements,
        c.progress_percentage as progress,
        c.is_active,
        c.is_banned,
        c.created_at,
        c.last_active,
        c.last_lesson_at,
        c.username,
        c.email,
        c.current_yct,
        c.current_hsk,
        c.days_active
      FROM children c
      WHERE c.child_id = $1
    `, [childId]);

    if (!childResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Child not found.'
      });
    }

    const child = childResult.rows[0];

    const parentCheck = await pool.query(
      `SELECT user_id, is_verified, is_banned, role FROM users WHERE user_id = $1`,
      [parentId]
    );

    if (!parentCheck.rows.length || parentCheck.rows[0].role !== 'parent') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. User is not a parent.'
      });
    }

    const parentUser = parentCheck.rows[0];
    if (!parentUser.is_verified || parentUser.is_banned) {
      return res.status(403).json({
        success: false,
        error: 'Parent account is not verified or is banned.'
      });
    }

    const parentRecordCheck = await pool.query(
      `SELECT parent_id FROM parents WHERE user_id = $1`,
      [parentId]
    );

    if (!parentRecordCheck.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Parent record not found.'
      });
    }

    const parentRecordId = parentRecordCheck.rows[0].parent_id;

    if (child.parent_id !== parentRecordId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. This child does not belong to you.'
      });
    }

    return res.json({
      success: true,
      child: {
        child_id: child.child_id,
        user_id: child.user_id,
        parent_id: child.parent_id,
        full_name: child.full_name,
        age: child.age,
        level: child.level || 'YCT 1',
        xp: child.xp || 0,
        streak: child.streak || 0,
        lessons_completed: child.lessons_completed || 0,
        achievements: child.achievements || 0,
        progress: child.progress || 0,
        is_active: child.is_active !== false,
        is_banned: child.is_banned || false,
        created_at: child.created_at,
        last_active: child.last_active,
        last_lesson_at: child.last_lesson_at,
        username: child.username || '',
        email: child.email || '',
        current_yct: child.current_yct || 1,
        current_hsk: child.current_hsk || 0,
        days_active: child.days_active || 0
      }
    });

  } catch (error) {
    console.error('❌ Error fetching child:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch child profile.'
    });
  }
});

// ==========================================
// ADD CHILD
// ==========================================
router.post('/parents/children', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { parentId, full_name, age, level, username, email, password } = req.body || {};

    if (!parentId || !full_name || !age || !username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Parent ID, full name, age, username, and password are required.'
      });
    }

    if (full_name.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Child name must be at least 2 characters.' });
    }

    if (age < 4 || age > 18) {
      return res.status(400).json({ success: false, error: 'Age must be between 4 and 18.' });
    }

    if (username.trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters.' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ success: false, error: 'Username can only contain letters, numbers, and underscores.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email ? email.trim().toLowerCase() : null;

    const existingCheck = await pool.query(`
      SELECT username, email FROM users 
      WHERE username = $1 OR (email = $2 AND $2 IS NOT NULL)
    `, [cleanUsername, cleanEmail]);

    if (existingCheck.rows.length > 0) {
      const conflict = existingCheck.rows[0];
      if (conflict.username === cleanUsername) {
        return res.status(409).json({ success: false, error: 'Username is already taken.' });
      }
      if (conflict.email === cleanEmail) {
        return res.status(409).json({ success: false, error: 'Email is already registered.' });
      }
    }

    let parentRecord = null;
    
    const parentQuery = await pool.query(`
      SELECT p.*, u.is_verified, u.is_banned, u.email as user_email
      FROM parents p
      JOIN users u ON p.user_id = u.user_id
      WHERE p.user_id = $1 OR p.parent_id = $1
    `, [parentId]);

    if (parentQuery.rows.length > 0) {
      parentRecord = parentQuery.rows[0];
    } else {
      const userCheck = await pool.query(`
        SELECT * FROM users WHERE user_id = $1 AND role = 'parent'
      `, [parentId]);

      if (userCheck.rows.length > 0) {
        const user = userCheck.rows[0];
        const insertParent = await pool.query(`
          INSERT INTO parents (user_id, full_name, email, is_verified, created_at, updated_at)
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          RETURNING *
        `, [user.user_id, user.full_name, user.email, user.is_verified]);

        parentRecord = insertParent.rows[0];
      } else {
        return res.status(404).json({
          success: false,
          error: 'Parent not found. Please make sure you are verified as a parent.'
        });
      }
    }

    if (!parentRecord.is_verified || parentRecord.is_banned) {
      return res.status(403).json({
        success: false,
        error: 'Parent account is not verified or is banned.'
      });
    }

    const cleanName = full_name.trim();
    const password_hash = await bcrypt.hash(password, 10);
    const finalEmail = cleanEmail || `${cleanUsername}@hanverse.child`;

    const userResult = await pool.query(`
      INSERT INTO users (
        username, full_name, email, password_hash, role, is_verified,
        is_banned, premium, xp, level, streak_days, lessons_completed,
        achievements_count, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'student', true, false, false, 0, 1, 0, 0, 0, NOW(), NOW())
      RETURNING user_id
    `, [cleanUsername, cleanName, finalEmail, password_hash]);

    const childUserId = userResult.rows[0].user_id;

    const childResult = await pool.query(`
      INSERT INTO children (
        parent_id, user_id, full_name, age, level, username, email, password_hash,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING child_id, user_id, full_name, age, level, username, email
    `, [
      parentRecord.parent_id,
      childUserId,
      cleanName,
      age,
      level || 'YCT 1',
      cleanUsername,
      finalEmail,
      password_hash
    ]);

    const newChild = childResult.rows[0];

    await pool.query(`
      UPDATE parents 
      SET children_count = children_count + 1, updated_at = NOW()
      WHERE parent_id = $1
    `, [parentRecord.parent_id]);

    await pool.query(`
      INSERT INTO child_activities (child_id, type, message, created_at)
      VALUES ($1, 'child_added', $2, NOW())
    `, [newChild.child_id, `Child ${cleanName} (${age} years old) was added to the account`]);

    return res.status(201).json({
      success: true,
      message: `Child ${cleanName} added successfully!`,
      child: {
        child_id: newChild.child_id,
        user_id: newChild.user_id,
        full_name: newChild.full_name,
        age: newChild.age,
        level: newChild.level,
        username: newChild.username || '',
        email: newChild.email || ''
      }
    });

  } catch (error) {
    console.error('❌ Error adding child:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add child. Please try again.'
    });
  }
});

// ==========================================
// UPDATE CHILD
// ==========================================
router.put('/parents/child/:childId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { childId } = req.params;
    const { name, age, level, email, parentId } = req.body || {};

    if (!parentId) {
      return res.status(400).json({
        success: false,
        error: 'Parent ID is required.'
      });
    }

    const parentCheck = await pool.query(
      `SELECT user_id, is_verified FROM users WHERE user_id = $1 AND role = 'parent'`,
      [parentId]
    );

    if (!parentCheck.rows.length || !parentCheck.rows[0].is_verified) {
      return res.status(403).json({
        success: false,
        error: 'Parent not verified.'
      });
    }

    const childCheck = await pool.query(
      `SELECT child_id FROM children WHERE child_id = $1 AND parent_id = $2`,
      [childId, parentId]
    );

    if (!childCheck.rows.length) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. This child does not belong to you.'
      });
    }

    let updates = [];
    let values = [];
    let paramIndex = 1;

    if (name !== undefined && name !== null) {
      updates.push(`full_name = $${paramIndex}`);
      values.push(name.trim());
      paramIndex++;
    }

    if (age !== undefined && age !== null) {
      updates.push(`age = $${paramIndex}`);
      values.push(parseInt(age));
      paramIndex++;
    }

    if (level !== undefined && level !== null) {
      updates.push(`level = $${paramIndex}`);
      values.push(level);
      paramIndex++;
    }

    if (email !== undefined && email !== null) {
      updates.push(`email = $${paramIndex}`);
      values.push(email.trim().toLowerCase());
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update.'
      });
    }

    updates.push(`updated_at = NOW()`);
    values.push(childId);

    const query = `
      UPDATE children 
      SET ${updates.join(', ')} 
      WHERE child_id = $${paramIndex}
      RETURNING child_id, full_name, age, level, email
    `;

    const result = await pool.query(query, values);

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Child not found.'
      });
    }

    if (email !== undefined && email !== null) {
      await pool.query(
        `UPDATE users SET email = $1 WHERE user_id = (SELECT user_id FROM children WHERE child_id = $2)`,
        [email.trim().toLowerCase(), childId]
      );
    }

    return res.json({
      success: true,
      message: 'Child updated successfully.',
      child: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Error updating child:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update child.'
    });
  }
});

// ==========================================
// UPDATE CHILD PROGRESS
// ==========================================
router.put('/parents/child/:childId/progress', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { childId } = req.params;
    const { lessons_completed, achievements, progress, xp, level, last_lesson_at } = req.body;

    const result = await pool.query(`
      UPDATE children 
      SET 
        lessons_completed = COALESCE($1, lessons_completed),
        achievements_count = COALESCE($2, achievements_count),
        progress_percentage = COALESCE($3, progress_percentage),
        xp = COALESCE($4, xp),
        level = COALESCE($5, level),
        last_lesson_at = COALESCE($6, last_lesson_at),
        updated_at = NOW()
      WHERE child_id = $7
      RETURNING child_id, full_name, lessons_completed, achievements_count, progress_percentage, xp, level
    `, [lessons_completed, achievements, progress, xp, level, last_lesson_at, childId]);

    if (!result.rows.length) {
      return res.status(404).json({ 
        success: false, 
        error: 'Child not found.' 
      });
    }

    const childResult = await pool.query(
      `SELECT user_id FROM children WHERE child_id = $1`,
      [childId]
    );

    if (childResult.rows.length && childResult.rows[0].user_id) {
      await pool.query(`
        UPDATE users 
        SET xp = $1, level = $2, updated_at = NOW()
        WHERE user_id = $3
      `, [xp || 0, level || 1, childResult.rows[0].user_id]);
    }

    await pool.query(`
      INSERT INTO child_activities (child_id, type, message, created_at)
      VALUES ($1, 'progress_updated', $2, NOW())
    `, [childId, `Progress updated: Level ${level || 'N/A'}, XP ${xp || 0}`]);

    return res.json({
      success: true,
      message: 'Progress updated successfully',
      child: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Error updating child progress:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update progress.'
    });
  }
});

// ==========================================
// GET CHILD ACTIVITIES
// ==========================================
router.get('/parents/child/:childId/activities', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { childId } = req.params;
    const { limit = 10 } = req.query;

    const result = await pool.query(`
      SELECT 
        activity_id,
        type,
        message,
        metadata,
        created_at
      FROM child_activities
      WHERE child_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [childId, limit]);

    return res.json({
      success: true,
      activities: result.rows
    });

  } catch (error) {
    console.error('❌ Error fetching child activities:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch activities.'
    });
  }
});

// ==========================================
// GET PARENT ACTIVITY FEED
// ==========================================
router.get('/parents/activity/:parentId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { parentId } = req.params;

    const parentResult = await pool.query(
      `SELECT parent_id FROM parents WHERE parent_id = $1 OR user_id = $1`,
      [parentId]
    );

    if (!parentResult.rows.length) {
      return res.status(404).json({ 
        success: false, 
        error: 'Parent not found.' 
      });
    }

    const parentRecordId = parentResult.rows[0].parent_id;

    const activitiesResult = await pool.query(`
      SELECT 
        ca.activity_id,
        ca.type,
        ca.message,
        ca.created_at,
        c.full_name as child_name,
        c.child_id
      FROM child_activities ca
      JOIN children c ON c.child_id = ca.child_id
      WHERE c.parent_id = $1
      ORDER BY ca.created_at DESC
      LIMIT 20
    `, [parentRecordId]);

    return res.json({
      success: true,
      activities: activitiesResult.rows.map(activity => ({
        activity_id: activity.activity_id,
        type: activity.type || 'info',
        message: activity.message || 'Activity occurred',
        created_at: activity.created_at,
        child_name: activity.child_name || 'Child',
        child_id: activity.child_id
      }))
    });

  } catch (error) {
    console.error('❌ Error fetching activity feed:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch activity feed.'
    });
  }
});

/* ==========================================
   PANDA AI INTERACTIVE TUTOR 🐼
========================================== */
router.post('/panda-chat', async (req, res) => {
  try {
    const { message } = req.body || {};

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message is required.'
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key is not configured.'
      });
    }

    const systemPrompt = `
You are Panda AI, a friendly Mandarin Chinese tutor for children aged 5–12 on HanVerse.

Rules:
- Use simple English
- Include pinyin where helpful
- Use emojis sometimes (🐼, 🌟, 🎉)
- Be warm, encouraging, and child-friendly
- Keep answers short and clear
- Help with Mandarin words, phrases, pronunciation, characters, tones, and YCT-style learning
- If the child asks something unsafe or inappropriate, gently refuse and redirect back to learning Chinese
- Make learning fun and interactive
- Use examples kids can relate to
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() || 
      '🐼 Hmm, I had a little trouble with that. Could you try asking me something else about Mandarin?';

    return res.json({
      success: true,
      reply
    });

  } catch (error) {
    console.error('❌ Panda OpenAI Error:', error);
    return res.status(500).json({
      success: false,
      error: error?.response?.data?.error?.message || error?.message || 'Panda AI is currently unavailable.'
    });
  }
});

/* ==========================================
   LESSONS ENDPOINTS 📚
========================================== */

// GET: All published lessons
router.get('/lessons', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const result = await pool.query(`
      SELECT 
        lesson_id,
        title,
        description,
        level,
        premium,
        xp,
        icon,
        order_index,
        vocabulary,
        quiz
      FROM lessons
      WHERE is_published = true
      ORDER BY level, order_index
    `);

    return res.json({
      success: true,
      lessons: result.rows.map(l => ({
        id: l.lesson_id,
        title: l.title,
        description: l.description,
        level: l.level,
        premium: l.premium,
        xp: l.xp || 10,
        icon: l.icon || '📚',
        vocabulary: l.vocabulary || [],
        quiz: l.quiz || []
      }))
    });

  } catch (error) {
    console.error('❌ Lessons error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch lessons'
    });
  }
});

// GET: Single lesson by ID
router.get('/lessons/:lessonId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { lessonId } = req.params;

    const result = await pool.query(`
      SELECT 
        lesson_id,
        title,
        description,
        content,
        level,
        premium,
        xp,
        icon,
        order_index,
        vocabulary,
        quiz,
        learning_objectives
      FROM lessons
      WHERE lesson_id = $1 AND is_published = true
    `, [lessonId]);

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Lesson not found'
      });
    }

    const l = result.rows[0];

    return res.json({
      success: true,
      lesson: {
        id: l.lesson_id,
        title: l.title,
        description: l.description,
        content: l.content || '',
        level: l.level,
        premium: l.premium,
        xp: l.xp || 10,
        icon: l.icon || '📚',
        vocabulary: l.vocabulary || [],
        quiz: l.quiz || [],
        learningObjectives: l.learning_objectives || []
      }
    });

  } catch (error) {
    console.error('❌ Lesson fetch error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch lesson'
    });
  }
});

/* ==========================================
   PROGRESS ENDPOINTS 📊
========================================== */

// GET: User progress for a specific lesson
router.get('/progress/:userId/:lessonId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { userId, lessonId } = req.params;

    const result = await pool.query(`
      SELECT 
        completed,
        score,
        xp_earned,
        time_spent,
        attempts,
        quiz_score,
        started_at,
        completed_at
      FROM user_progress
      WHERE user_id = $1 AND lesson_id = $2
    `, [userId, lessonId]);

    if (!result.rows.length) {
      return res.json({
        success: true,
        progress: null,
        completed: false
      });
    }

    return res.json({
      success: true,
      progress: result.rows[0],
      completed: result.rows[0].completed
    });

  } catch (error) {
    console.error('❌ Progress fetch error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch progress'
    });
  }
});

// POST: Save or update lesson progress
router.post('/progress', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { 
      userId, 
      lessonId, 
      completed, 
      score, 
      xpEarned, 
      timeSpent,
      quizAnswers,
      quizScore
    } = req.body || {};

    if (!userId || !lessonId) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Lesson ID are required'
      });
    }

    const existing = await pool.query(`
      SELECT id FROM user_progress 
      WHERE user_id = $1 AND lesson_id = $2
    `, [userId, lessonId]);

    let result;

    if (existing.rows.length) {
      result = await pool.query(`
        UPDATE user_progress 
        SET 
          completed = COALESCE($1, completed),
          score = COALESCE($2, score),
          xp_earned = COALESCE($3, xp_earned),
          time_spent = COALESCE($4, time_spent),
          quiz_answers = COALESCE($5, quiz_answers),
          quiz_score = COALESCE($6, quiz_score),
          attempts = attempts + 1,
          completed_at = CASE WHEN $1 = true THEN NOW() ELSE completed_at END,
          updated_at = NOW()
        WHERE user_id = $7 AND lesson_id = $8
        RETURNING *
      `, [
        completed, 
        score, 
        xpEarned, 
        timeSpent, 
        quizAnswers, 
        quizScore, 
        userId, 
        lessonId
      ]);
    } else {
      result = await pool.query(`
        INSERT INTO user_progress (
          user_id,
          lesson_id,
          completed,
          score,
          xp_earned,
          time_spent,
          quiz_answers,
          quiz_score,
          attempts,
          started_at,
          completed_at,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, NOW(), 
          CASE WHEN $3 = true THEN NOW() ELSE NULL END,
          NOW(), NOW()
        )
        RETURNING *
      `, [
        userId, 
        lessonId, 
        completed, 
        score, 
        xpEarned, 
        timeSpent, 
        quizAnswers, 
        quizScore
      ]);
    }

    if (completed && xpEarned) {
      await pool.query(`
        UPDATE users 
        SET 
          xp = xp + $1,
          lessons_completed = lessons_completed + 1,
          last_lesson_at = NOW(),
          updated_at = NOW()
        WHERE user_id = $2
      `, [xpEarned, userId]);

      const userResult = await pool.query(
        `SELECT xp FROM users WHERE user_id = $1`,
        [userId]
      );
      
      if (userResult.rows.length) {
        const xp = userResult.rows[0].xp;
        const newLevel = Math.floor(xp / 100) + 1;
        await pool.query(
          `UPDATE users SET level = $1 WHERE user_id = $2 AND level < $1`,
          [newLevel, userId]
        );
      }
    }

    return res.json({
      success: true,
      message: 'Progress saved successfully',
      progress: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Save progress error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to save progress'
    });
  }
});

/* ==========================================
   WORKSHEETS ENDPOINTS 📝
========================================== */

// GET: All worksheets
router.get('/worksheets', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const result = await pool.query(`
      SELECT 
        worksheet_id,
        title,
        description,
        level,
        category,
        file_url,
        premium,
        download_count
      FROM worksheets
      WHERE is_published = true
      ORDER BY level, worksheet_id
    `);

    return res.json({
      success: true,
      worksheets: result.rows.map(w => ({
        id: w.worksheet_id,
        title: w.title,
        description: w.description || '',
        level: w.level,
        category: w.category || 'yct',
        fileUrl: w.file_url || '',
        premium: w.premium || false,
        icon: '📄',
        downloads: w.download_count || 0
      }))
    });

  } catch (error) {
    console.error('❌ Worksheets error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch worksheets'
    });
  }
});

// GET: Download worksheet
router.get('/worksheets/download/:id', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { id } = req.params;

    const result = await pool.query(`
      SELECT worksheet_id, title, file_url, file_type, file_size
      FROM worksheets
      WHERE worksheet_id = $1 AND is_published = true
    `, [id]);

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Worksheet not found'
      });
    }

    const worksheet = result.rows[0];

    await pool.query(`
      UPDATE worksheets 
      SET download_count = download_count + 1
      WHERE worksheet_id = $1
    `, [id]);

    return res.json({
      success: true,
      worksheet: {
        id: worksheet.worksheet_id,
        title: worksheet.title,
        fileUrl: worksheet.file_url,
        fileType: worksheet.file_type,
        fileSize: worksheet.file_size
      }
    });

  } catch (error) {
    console.error('❌ Download error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to download worksheet'
    });
  }
});

/* ==========================================
   STATS ENDPOINT 📊
========================================== */
router.get('/stats', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const [
      studentsResult,
      lessonsResult,
      gamesResult,
      satisfactionResult
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users WHERE role = $1', ['student']),
      pool.query('SELECT COUNT(*) FROM lessons WHERE is_published = true'),
      pool.query('SELECT COUNT(*) FROM games WHERE is_active = true'),
      pool.query('SELECT AVG(rating) FROM parent_reviews WHERE rating IS NOT NULL')
    ]);

    const totalStudents = parseInt(studentsResult.rows[0]?.count || 0);
    const totalLessons = parseInt(lessonsResult.rows[0]?.count || 0);
    const totalGames = parseInt(gamesResult.rows[0]?.count || 0);
    const avgRating = parseFloat(satisfactionResult.rows[0]?.avg || 0);

    return res.json({
      success: true,
      totalStudents: Math.max(totalStudents, 500),
      totalLessons: Math.max(totalLessons, 240),
      totalGames: Math.max(totalGames, 30),
      satisfactionRate: Math.max(Math.round(avgRating * 10), 95)
    });

  } catch (error) {
    console.error('❌ Stats error:', error);
    return res.json({
      success: true,
      totalStudents: 500,
      totalLessons: 240,
      totalGames: 30,
      satisfactionRate: 95
    });
  }
});

/* ==========================================
   PLACEMENT TEST ENDPOINT 🎯
========================================== */
router.post('/placement', async (req, res) => {
  try {
    const { userId } = req.body || {};

    let recommendedLevel = 1;

    if (userId) {
      const result = await pool.query(
        `SELECT xp FROM users WHERE user_id = $1`,
        [userId]
      );
      
      if (result.rows.length) {
        const xp = result.rows[0].xp || 0;
        if (xp >= 1000) recommendedLevel = 4;
        else if (xp >= 500) recommendedLevel = 3;
        else if (xp >= 200) recommendedLevel = 2;
      }
    }

    return res.json({
      success: true,
      level: recommendedLevel,
      message: `Recommended YCT ${recommendedLevel}`,
      description: `Based on your current progress, we recommend starting at YCT ${recommendedLevel}.`
    });

  } catch (error) {
    console.error('❌ Placement error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to assess level'
    });
  }
});

/* ==========================================
   SYNC ENDPOINTS
========================================== */

// Sync quiz results
app.post('/api/sync/quizzes', async (req, res) => {
  try {
    if (!ensurePool(res)) return;
    
    const { userId, quizzes } = req.body;
    
    const userResult = await pool.query(
      `SELECT user_id FROM users WHERE user_id = $1`,
      [userId]
    );
    
    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    for (const quiz of quizzes) {
      await pool.query(`
        INSERT INTO quiz_results (user_id, quiz_id, answers, score, timestamp)
        VALUES ($1, $2, $3, $4, $5)
      `, [userId, quiz.quizId, quiz.answers, quiz.score, quiz.timestamp]);
      
      if (quiz.score >= 70) {
        await pool.query(`
          UPDATE users SET xp = xp + $1 WHERE user_id = $2
        `, [10, userId]);
      }
    }
    
    res.json({ success: true, processed: quizzes.length });
  } catch (error) {
    console.error('Quiz sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Sync progress
app.post('/api/sync/progress', async (req, res) => {
  try {
    if (!ensurePool(res)) return;
    
    const { userId, progress } = req.body;
    
    for (const item of progress) {
      const existing = await pool.query(`
        SELECT 1 FROM user_progress 
        WHERE user_id = $1 AND lesson_id = $2
      `, [userId, item.lessonId]);
      
      if (existing.rows.length > 0) {
        await pool.query(`
          UPDATE user_progress 
          SET completed = $1, score = $2, xp_earned = $3, timestamp = $4, updated_at = NOW()
          WHERE user_id = $5 AND lesson_id = $6
        `, [item.completed, item.score, item.xpEarned, item.timestamp, userId, item.lessonId]);
      } else {
        await pool.query(`
          INSERT INTO user_progress (user_id, lesson_id, completed, score, xp_earned, timestamp, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        `, [userId, item.lessonId, item.completed, item.score, item.xpEarned, item.timestamp]);
      }
    }
    
    res.json({ success: true, processed: progress.length });
  } catch (error) {
    console.error('Progress sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Sync XP
app.post('/api/sync/xp', async (req, res) => {
  try {
    if (!ensurePool(res)) return;
    
    const { userId, xp, entries } = req.body;
    
    await pool.query(`
      UPDATE users SET xp = xp + $1 WHERE user_id = $2
    `, [xp, userId]);
    
    for (const entry of entries) {
      await pool.query(`
        INSERT INTO xp_logs (user_id, amount, source, timestamp, created_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [userId, entry.xp, entry.source, entry.timestamp]);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('XP sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Sync achievements
app.post('/api/sync/achievements', async (req, res) => {
  try {
    if (!ensurePool(res)) return;
    
    const { userId, achievements } = req.body;
    
    for (const achievement of achievements) {
      const existing = await pool.query(`
        SELECT 1 FROM user_achievements 
        WHERE user_id = $1 AND achievement_id = $2
      `, [userId, achievement.achievementId]);
      
      if (existing.rows.length === 0) {
        await pool.query(`
          INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, created_at)
          VALUES ($1, $2, $3, NOW())
        `, [userId, achievement.achievementId, achievement.timestamp]);
        
        await pool.query(`
          UPDATE users SET achievements_count = achievements_count + 1
          WHERE user_id = $1
        `, [userId]);
      }
    }
    
    res.json({ success: true, processed: achievements.length });
  } catch (error) {
    console.error('Achievement sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Sync streak
app.post('/api/sync/streak', async (req, res) => {
  try {
    if (!ensurePool(res)) return;
    
    const { userId, count, lastDate } = req.body;
    
    await pool.query(`
      UPDATE users 
      SET streak_days = $1, last_active = $2, updated_at = NOW()
      WHERE user_id = $3
    `, [count, lastDate, userId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Streak sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

/* ==========================================
   ADMIN ENDPOINTS 🔐
========================================== */

// Verify Admin Password
router.post('/admin/verify-password', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { userId, adminPassword } = req.body || {};

    if (!userId || !adminPassword) {
      return res.status(400).json({
        success: false,
        error: 'User ID and admin password are required.'
      });
    }

    const userResult = await pool.query(
      `SELECT * FROM users WHERE user_id = $1`,
      [userId]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const user = userResult.rows[0];

    if (!user.is_admin) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied. You do not have administrator permissions.' 
      });
    }

    const valid = await bcrypt.compare(adminPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid admin password.' });
    }

    const adminToken = generateToken(32);

    return res.json({
      success: true,
      adminToken
    });

  } catch (error) {
    console.error('❌ Admin verification error:', error);
    return res.status(500).json({ success: false, error: 'Admin validation failed.' });
  }
});

// Get all parents (admin)
router.get('/admin/parents', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const result = await pool.query(`
      SELECT 
        p.parent_id,
        p.user_id,
        p.full_name,
        p.email,
        p.phone,
        p.is_verified,
        p.verified_at,
        p.is_active,
        p.is_banned,
        p.max_children,
        p.children_count,
        p.created_at,
        p.last_login,
        u.username,
        u.profile_picture,
        u.is_admin,
        (
          SELECT COUNT(*) 
          FROM users c 
          WHERE c.parent_id = p.parent_id 
          AND c.role = 'student'
        ) as actual_children_count
      FROM parents p
      LEFT JOIN users u ON p.user_id = u.user_id
      ORDER BY p.created_at DESC
    `);

    return res.json({
      success: true,
      parents: result.rows
    });

  } catch (error) {
    console.error('❌ Error fetching parents:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch parents'
    });
  }
});

// Get pending parents (admin)
router.get('/admin/parents/pending', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const result = await pool.query(`
      SELECT 
        p.parent_id,
        p.user_id,
        p.full_name,
        p.email,
        p.phone,
        p.created_at,
        u.username
      FROM parents p
      LEFT JOIN users u ON p.user_id = u.user_id
      WHERE p.is_verified = false AND p.is_active = true
      ORDER BY p.created_at DESC
    `);

    return res.json({
      success: true,
      pendingParents: result.rows
    });

  } catch (error) {
    console.error('❌ Error fetching pending parents:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch pending parents'
    });
  }
});

// Verify a parent (admin)
router.post('/admin/parents/verify/:parentId', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { parentId } = req.params;
    const adminUserId = req.body.adminUserId || null;

    const parentResult = await pool.query(`
      SELECT p.*, u.email, u.username 
      FROM parents p
      JOIN users u ON p.user_id = u.user_id
      WHERE p.parent_id = $1
    `, [parentId]);

    if (!parentResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Parent not found'
      });
    }

    const parent = parentResult.rows[0];

    await pool.query(`
      UPDATE parents 
      SET is_verified = true,
          verified_at = NOW(),
          verified_by = $1,
          updated_at = NOW()
      WHERE parent_id = $2
    `, [adminUserId, parentId]);

    await pool.query(`
      UPDATE users 
      SET is_verified = true 
      WHERE user_id = $1
    `, [parent.user_id]);

    await pool.query(`
      INSERT INTO parent_logs (parent_id, action, details, performed_by)
      VALUES ($1, 'verify', 'Parent account verified by admin', $2)
    `, [parentId, adminUserId]);

    try {
      if (mailer) {
        await sendVerificationEmail({
          to: parent.email,
          username: parent.username,
          fullName: parent.full_name,
          token: 'verified_by_admin'
        });
      }
    } catch (mailErr) {
      console.warn('⚠️ Verification email failed:', mailErr.message);
    }

    return res.json({
      success: true,
      message: 'Parent verified successfully',
      parent: {
        parent_id: parent.parent_id,
        full_name: parent.full_name,
        email: parent.email,
        is_verified: true,
        verified_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error verifying parent:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to verify parent'
    });
  }
});

// Deny a parent (admin)
router.post('/admin/parents/deny/:parentId', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { parentId } = req.params;
    const { reason } = req.body || {};
    const adminUserId = req.body.adminUserId || null;

    const parentResult = await pool.query(`
      SELECT p.*, u.email, u.username 
      FROM parents p
      JOIN users u ON p.user_id = u.user_id
      WHERE p.parent_id = $1
    `, [parentId]);

    if (!parentResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Parent not found'
      });
    }

    const parent = parentResult.rows[0];

    await pool.query(`
      UPDATE parents 
      SET is_active = false,
          is_verified = false,
          updated_at = NOW()
      WHERE parent_id = $1
    `, [parentId]);

    await pool.query(`
      UPDATE users 
      SET role = 'student',
          is_verified = false
      WHERE user_id = $1
    `, [parent.user_id]);

    await pool.query(`
      INSERT INTO parent_logs (parent_id, action, details, performed_by)
      VALUES ($1, 'deny', $2, $3)
    `, [parentId, `Parent access denied. Reason: ${reason || 'Not specified'}`, adminUserId]);

    return res.json({
      success: true,
      message: 'Parent access denied',
      parent: {
        parent_id: parent.parent_id,
        full_name: parent.full_name,
        email: parent.email,
        is_verified: false,
        is_active: false
      }
    });

  } catch (error) {
    console.error('❌ Error denying parent:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to deny parent'
    });
  }
});

// Admin overview
router.get('/admin/overview', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const usersQuery = await pool.query(
      `SELECT * FROM users ORDER BY created_at DESC`
    );

    return res.json({
      success: true,
      users: usersQuery.rows.map(u => safeUser(u)),
      progress: [],
      achievements: [],
      daily_goals: [],
      notifications: [],
      vocabulary: [],
      settings: []
    });

  } catch (error) {
    console.error('❌ Admin overview error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load admin data' });
  }
});

// Get pending users (admin)
router.get('/admin/pending-parents', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const result = await pool.query(
      `SELECT user_id, username, full_name, email, created_at 
       FROM users WHERE is_verified = false 
       ORDER BY created_at DESC`
    );
    
    return res.json({ success: true, pendingUsers: result.rows });
  } catch (error) {
    console.error('❌ Error fetching pending parents:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch pending accounts' });
  }
});

// Admin: Update user
router.post('/admin/users/update/:id', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const targetUserId = req.params.id;
    const { full_name, username, email, level, xp, is_admin, is_banned, premium, is_verified, password, role } = req.body || {};

    if (!full_name || !username || !email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Full name, username, and email are required.' 
      });
    }

    const oldUserRes = await pool.query(
      `SELECT email, username, is_admin, premium, xp, level, is_banned, is_verified, role FROM users WHERE user_id = $1`, 
      [targetUserId]
    );
    
    if (oldUserRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    
    const oldUser = oldUserRes.rows[0];

    let query = `UPDATE users SET 
      full_name = $1, 
      username = $2, 
      email = $3, 
      level = $4, 
      xp = $5, 
      is_admin = $6, 
      is_banned = $7, 
      premium = $8, 
      is_verified = $9`;
    
    let params = [full_name, username, email, level, xp, is_admin, is_banned, premium, is_verified];

    let paramIndex = 10;
    if (role) {
      query += `, role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }

    if (password && password.trim().length >= 6) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      query += `, password_hash = $${paramIndex}`;
      params.push(hash);
      paramIndex++;
    }

    query += ` WHERE user_id = $${paramIndex}`;
    params.push(targetUserId);

    await pool.query(query, params);

    return res.json({ 
      success: true, 
      message: 'User updated successfully.'
    });

  } catch (error) {
    console.error('❌ Update error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update user.' });
  }
});

// Admin: Ban/Unban user
router.post('/admin/users/ban/:id', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const targetUserId = req.params.id;
    const { is_banned, banned_reason } = req.body;

    if (typeof is_banned !== 'boolean') {
      return res.status(400).json({ success: false, error: 'is_banned must be a boolean value.' });
    }

    await pool.query(
      `UPDATE users SET is_banned = $1, banned_reason = $2 WHERE user_id = $3`, 
      [is_banned, banned_reason || null, targetUserId]
    );

    return res.json({ 
      success: true, 
      message: `User ${is_banned ? 'banned' : 'unbanned'} successfully.`
    });

  } catch (error) {
    console.error('❌ Ban error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update ban status.' });
  }
});

// Admin: Delete user
router.delete('/admin/users/delete/:id', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const targetUserId = req.params.id;

    await pool.query(`DELETE FROM user_progress WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM user_achievements WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM email_verifications WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM users WHERE user_id = $1`, [targetUserId]);

    return res.json({ 
      success: true, 
      message: 'User permanently deleted.' 
    });

  } catch (error) {
    console.error('❌ Deletion error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete user.' });
  }
});

// Admin: Toggle verification
router.post('/admin/toggle-verification/:userId', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;
    
    const { userId } = req.params;
    const { verified } = req.body;
    
    const userResult = await pool.query(
      `SELECT is_verified FROM users WHERE user_id = $1`,
      [userId]
    );
    
    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const newStatus = verified !== undefined ? verified : !userResult.rows[0].is_verified;
    
    await pool.query(
      `UPDATE users 
       SET is_verified = $1, 
           verified_at = CASE WHEN $1 = true THEN NOW() ELSE NULL END,
           email_confirmed = $1
       WHERE user_id = $2`,
      [newStatus, userId]
    );
    
    return res.json({
      success: true,
      message: `User verification set to ${newStatus}`,
      is_verified: newStatus
    });
    
  } catch (error) {
    console.error('❌ Toggle verification error:', error);
    return res.status(500).json({ success: false, error: 'Failed to toggle verification' });
  }
});
// ==========================================
// SEND INVITATION EMAIL 📨
// ==========================================
router.post('/send-invite', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { inviterId, inviteeEmail, inviteeName, customMessage } = req.body || {};

    if (!inviterId || !inviteeEmail) {
      return res.status(400).json({
        success: false,
        error: 'Inviter ID and invitee email are required.'
      });
    }

    // Get inviter info
    const inviterResult = await pool.query(
      `SELECT username, full_name FROM users WHERE user_id = $1`,
      [inviterId]
    );

    if (!inviterResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Inviter not found.'
      });
    }

    const inviter = inviterResult.rows[0];
    const inviterName = inviter.full_name || inviter.username;
    const signupLink = `${getFrontendBaseUrl()}/signup.html?ref=${inviter.username}`;

    // Build the invite email HTML
    const inviteHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You're Invited to HanVerse! 🐼</title>
        <style>
          body {
            font-family: 'Poppins', Arial, sans-serif;
            background: #0F172A;
            color: #E8E8F0;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 560px;
            margin: 40px auto;
            background: linear-gradient(145deg, #1E293B, #0F172A);
            border-radius: 24px;
            padding: 48px 40px;
            border: 1px solid rgba(255,255,255,0.06);
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
          }
          .header {
            text-align: center;
            margin-bottom: 32px;
          }
          .logo-wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            margin-bottom: 8px;
          }
          .brand {
            font-size: 28px;
            font-weight: 800;
            background: linear-gradient(135deg, #60A5FA, #34D399);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
          }
          .title {
            font-size: 26px;
            font-weight: 700;
            color: #FFFFFF;
            text-align: center;
            margin: 20px 0 12px;
          }
          .subtitle {
            color: #94A3B8;
            text-align: center;
            line-height: 1.7;
            font-size: 15px;
            margin-bottom: 28px;
          }
          .invite-message {
            background: rgba(255,255,255,0.03);
            border-radius: 12px;
            padding: 20px;
            margin: 16px 0;
            border-left: 4px solid #3B82F6;
            color: #E8E8F0;
            font-style: italic;
          }
          .button-container {
            text-align: center;
            margin: 32px 0;
          }
          .button {
            display: inline-block;
            padding: 16px 44px;
            background: linear-gradient(135deg, #3B82F6, #14B8A6);
            color: white;
            text-decoration: none;
            border-radius: 12px;
            font-weight: 600;
            font-size: 16px;
            box-shadow: 0 4px 20px rgba(59, 130, 246, 0.3);
          }
          .perks {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin: 20px 0;
          }
          .perk {
            text-align: center;
            padding: 12px;
            background: rgba(255,255,255,0.03);
            border-radius: 8px;
          }
          .perk .icon { font-size: 24px; display: block; }
          .perk .label { color: #94A3B8; font-size: 13px; margin-top: 4px; display: block; }
          .footer {
            text-align: center;
            color: #64748B;
            font-size: 13px;
            margin-top: 32px;
            padding-top: 24px;
            border-top: 1px solid rgba(255,255,255,0.06);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo-wrapper">
              <span style="font-size: 42px;">🐼</span>
              <span class="brand">HanVerse</span>
            </div>
          </div>

          <div class="title">🌟 You're Invited to HanVerse!</div>

          <div class="subtitle">
            <strong>${inviterName}</strong> has invited you to join the fun way to learn Mandarin! 🎉
          </div>

          ${customMessage ? `<div class="invite-message">"${customMessage}"</div>` : ''}

          <div class="perks">
            <div class="perk">
              <span class="icon">📚</span>
              <span class="label">Interactive Stories</span>
            </div>
            <div class="perk">
              <span class="icon">🎮</span>
              <span class="label">Fun Games</span>
            </div>
            <div class="perk">
              <span class="icon">🤖</span>
              <span class="label">AI Panda Tutor</span>
            </div>
            <div class="perk">
              <span class="icon">🏆</span>
              <span class="label">Achievements</span>
            </div>
          </div>

          <div style="text-align: center; color: #F59E0B; font-size: 14px; margin: 16px 0;">
            ✨ <strong>Bonus:</strong> When you sign up, you'll both get 50 bonus XP! ✨
          </div>

          <div class="button-container">
            <a href="${signupLink}" class="button">🎯 Join HanVerse Now</a>
          </div>

          <div class="footer">
            <p>Start your Mandarin adventure today! 🐼<br>
            <span style="font-size: 12px; color: #475569;">
              This invitation was sent by a HanVerse member.
            </span></p>
          </div>
        </div>
      </body>
      </html>
    `;

    if (mailer) {
      await mailer.sendMail({
        from: EMAIL_FROM,
        to: inviteeEmail,
        subject: `🌟 ${inviterName} invited you to HanVerse!`,
        html: inviteHTML
      });
    } else {
      return res.status(500).json({ 
        success: false, 
        error: 'Email service not available.' 
      });
    }

    // Log the invitation
    try {
      await pool.query(`
        INSERT INTO invitations (inviter_id, invitee_email, invitee_name, custom_message, sent_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [inviterId, inviteeEmail, inviteeName || null, customMessage || null]);
    } catch (logError) {
      console.warn('⚠️ Could not log invitation:', logError.message);
    }

    return res.json({
      success: true,
      message: `Invitation sent to ${inviteeEmail}!`
    });

  } catch (error) {
    console.error('❌ Invite error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send invitation.'
    });
  }
});

/* ==========================================
   HEALTH & ROUTES 🩺
========================================== */
router.get('/health', (req, res) => {
  return res.json({
    ok: true,
    app: 'HanVerse',
    status: 'Running',
    version: '2.0.0',
    database: pool ? 'connected' : 'disconnected',
    email: mailer ? 'configured' : 'not configured'
  });
});

router.get('/routes', (req, res) => {
  return res.json({
    routes: [
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/health' },
      { method: 'GET', path: '/routes' },
      { method: 'POST', path: '/signup' },
      { method: 'POST', path: '/login' },
      { method: 'GET', path: '/user/:userId' },
      { method: 'POST', path: '/auth/refresh' },
      { method: 'POST', path: '/auth/logout' },
      { method: 'POST', path: '/auth/send-verification' },
      { method: 'POST', path: '/auth/resend-verification' },
      { method: 'GET', path: '/auth/verification-status/:userId' },
      { method: 'GET', path: '/verify-email' },
      { method: 'POST', path: '/verify-email' },
      { method: 'POST', path: '/forgot-password' },
      { method: 'POST', path: '/reset-password' },
      { method: 'POST', path: '/verify-parent-password' },
      { method: 'GET', path: '/parents/children/:parentId' },
      { method: 'GET', path: '/parents/child/:childId' },
      { method: 'POST', path: '/parents/children' },
      { method: 'PUT', path: '/parents/child/:childId' },
      { method: 'PUT', path: '/parents/child/:childId/progress' },
      { method: 'GET', path: '/parents/child/:childId/activities' },
      { method: 'GET', path: '/parents/activity/:parentId' },
      { method: 'POST', path: '/panda-chat' },
      { method: 'GET', path: '/lessons' },
      { method: 'GET', path: '/lessons/:lessonId' },
      { method: 'GET', path: '/progress/:userId/:lessonId' },
      { method: 'POST', path: '/progress' },
      { method: 'GET', path: '/worksheets' },
      { method: 'GET', path: '/worksheets/download/:id' },
      { method: 'GET', path: '/stats' },
      { method: 'POST', path: '/placement' },
      { method: 'POST', path: '/admin/verify-password' },
      { method: 'GET', path: '/admin/overview' },
      { method: 'GET', path: '/admin/parents' },
      { method: 'GET', path: '/admin/parents/pending' },
      { method: 'POST', path: '/admin/parents/verify/:parentId' },
      { method: 'POST', path: '/admin/parents/deny/:parentId' },
      { method: 'GET', path: '/admin/pending-parents' },
      { method: 'POST', path: '/admin/users/update/:id' },
      { method: 'POST', path: '/admin/users/ban/:id' },
      { method: 'DELETE', path: '/admin/users/delete/:id' },
      { method: 'POST', path: '/admin/toggle-verification/:userId' }
    ]
  });
});

router.get('/', (req, res) => {
  return res.json({
    ok: true,
    message: 'HanVerse API',
    version: '2.0.0',
    endpoints: [
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/health' },
      { method: 'GET', path: '/routes' },
      { method: 'POST', path: '/signup' },
      { method: 'POST', path: '/login' },
      { method: 'GET', path: '/user/:userId' },
      { method: 'POST', path: '/panda-chat' }
    ]
  });
});
// ==========================================
// ADMIN ROUTES - ADD THESE TO SERVER.JS
// ==========================================

// Verify Admin Password
router.post('/admin/verify-password', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { userId, adminPassword } = req.body || {};

    if (!userId || !adminPassword) {
      return res.status(400).json({
        success: false,
        error: 'User ID and admin password are required.'
      });
    }

    const userResult = await pool.query(
      `SELECT * FROM users WHERE user_id = $1`,
      [userId]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const user = userResult.rows[0];

    if (!user.is_admin) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied. You do not have administrator permissions.' 
      });
    }

    const valid = await bcrypt.compare(adminPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid admin password.' });
    }

    const adminToken = generateToken(32);

    return res.json({
      success: true,
      adminToken
    });

  } catch (error) {
    console.error('❌ Admin verification error:', error);
    return res.status(500).json({ success: false, error: 'Admin validation failed.' });
  }
});

// Admin Overview - Get all users
router.get('/admin/overview', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const usersQuery = await pool.query(
      `SELECT * FROM users ORDER BY created_at DESC`
    );

    return res.json({
      success: true,
      users: usersQuery.rows.map(u => safeUser(u)),
    });

  } catch (error) {
    console.error('❌ Admin overview error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load admin data' });
  }
});

// Admin: Email Broadcast
router.post('/admin/email-all', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { subject, message } = req.body || {};
    if (!subject || !message) {
      return res.status(400).json({ success: false, error: 'Subject and message body are required.' });
    }

    const usersResult = await pool.query(
      `SELECT email, username FROM users WHERE is_verified = true AND is_banned = false AND email IS NOT NULL AND email != ''`
    );

    const users = usersResult.rows;
    if (users.length === 0) {
      return res.json({ success: true, message: 'No verified, active users found to email.', sent: 0 });
    }

    let sendCount = 0;
    for (const user of users) {
      try {
        const html = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
            <div style="text-align: center; margin-bottom: 20px;">
              <span style="font-size: 3rem;">🐼</span>
              <h2 style="color: #ff416c; margin: 10px 0 0 0;">HanVerse Announcement</h2>
            </div>
            <p>Hi ${user.username || 'Learner'},</p>
            <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ff416c;">
              ${message.replace(/\n/g, '<br>')}
            </div>
            <p style="font-size: 0.85rem; color: #6b7280; text-align: center; margin-top: 30px;">
              You received this email because you are a verified member of HanVerse.<br>
              🐼 Happy Learning!
            </p>
          </div>
        `;

        if (mailer) {
          await mailer.sendMail({
            from: EMAIL_FROM,
            to: user.email,
            subject: subject,
            html: html
          });
          sendCount++;
        }
      } catch (mailErr) {
        console.warn(`⚠️ Failed sending bulk announcement to ${user.email}:`, mailErr.message);
      }
    }

    return res.json({
      success: true,
      message: `Successfully dispatched announcements to ${sendCount} active users.`,
      sent: sendCount
    });

  } catch (error) {
    console.error('❌ Bulk announcement failure:', error);
    return res.status(500).json({ success: false, error: 'Bulk email system failed.' });
  }
});

// Admin: Single Email
router.post('/admin/users/email/:id', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const targetUserId = req.params.id;
    const { subject, message } = req.body || {};

    if (!subject || !message) {
      return res.status(400).json({ success: false, error: 'Subject and message body fields are required.' });
    }

    const userResult = await pool.query(
      `SELECT email, username FROM users WHERE user_id = $1`,
      [targetUserId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Target user could not be found.' });
    }

    const targetUser = userResult.rows[0];

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <span style="font-size: 3rem;">🐼</span>
          <h2 style="color: #ff416c; margin: 10px 0 0 0;">HanVerse Account Notice</h2>
        </div>
        <p>Hi ${targetUser.username || 'Learner'},</p>
        <p>An administrator has sent you a direct message regarding your account status or milestone achievement:</p>
        <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ff416c;">
          ${message.replace(/\n/g, '<br>')}
        </div>
        <p style="font-size: 0.85rem; color: #6b7280; text-align: center; margin-top: 30px;">
          Please do not reply directly to this automated system address.<br>
          🐼 Happy Learning!
        </p>
      </div>
    `;

    if (mailer) {
      await mailer.sendMail({
        from: EMAIL_FROM,
        to: targetUser.email,
        subject: subject,
        html: html
      });
    } else {
      return res.status(500).json({ success: false, error: 'Email service not available.' });
    }

    return res.json({
      success: true,
      message: `Direct communication sent successfully to ${targetUser.email}`
    });

  } catch (error) {
    console.error('❌ Individual direct email pipeline failure:', error);
    return res.status(500).json({ success: false, error: 'Internal mail transport error.' });
  }
});

// Admin: Update User
router.post('/admin/users/update/:id', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const targetUserId = req.params.id;
    const { full_name, username, email, level, xp, is_admin, is_banned, premium, is_verified, password, role } = req.body || {};

    if (!full_name || !username || !email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Full name, username, and email are required.' 
      });
    }

    const oldUserRes = await pool.query(
      `SELECT email, username, is_admin, premium, xp, level, is_banned, is_verified, role FROM users WHERE user_id = $1`, 
      [targetUserId]
    );
    
    if (oldUserRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    
    const oldUser = oldUserRes.rows[0];

    let query = `UPDATE users SET 
      full_name = $1, 
      username = $2, 
      email = $3, 
      level = $4, 
      xp = $5, 
      is_admin = $6, 
      is_banned = $7, 
      premium = $8, 
      is_verified = $9`;
    
    let params = [full_name, username, email, level, xp, is_admin, is_banned, premium, is_verified];

    let paramIndex = 10;
    if (role) {
      query += `, role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }

    if (password && password.trim().length >= 6) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      query += `, password_hash = $${paramIndex}`;
      params.push(hash);
      paramIndex++;
    }

    query += ` WHERE user_id = $${paramIndex}`;
    params.push(targetUserId);

    await pool.query(query, params);

    return res.json({ 
      success: true, 
      message: 'User updated successfully.'
    });

  } catch (error) {
    console.error('❌ Update error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update user.' });
  }
});

// Admin: Ban/Unban user
router.post('/admin/users/ban/:id', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const targetUserId = req.params.id;
    const { is_banned, banned_reason } = req.body;

    if (typeof is_banned !== 'boolean') {
      return res.status(400).json({ success: false, error: 'is_banned must be a boolean value.' });
    }

    await pool.query(
      `UPDATE users SET is_banned = $1, banned_reason = $2 WHERE user_id = $3`, 
      [is_banned, banned_reason || null, targetUserId]
    );

    return res.json({ 
      success: true, 
      message: `User ${is_banned ? 'banned' : 'unbanned'} successfully.`
    });

  } catch (error) {
    console.error('❌ Ban error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update ban status.' });
  }
});

// Admin: Delete user
router.delete('/admin/users/delete/:id', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const targetUserId = req.params.id;

    await pool.query(`DELETE FROM user_progress WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM user_achievements WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM email_verifications WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM users WHERE user_id = $1`, [targetUserId]);

    return res.json({ 
      success: true, 
      message: 'User permanently deleted.' 
    });

  } catch (error) {
    console.error('❌ Deletion error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete user.' });
  }
});

// Admin: Toggle verification
router.post('/admin/toggle-verification/:userId', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;
    
    const { userId } = req.params;
    const { verified } = req.body;
    
    const userResult = await pool.query(
      `SELECT is_verified FROM users WHERE user_id = $1`,
      [userId]
    );
    
    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const newStatus = verified !== undefined ? verified : !userResult.rows[0].is_verified;
    
    await pool.query(
      `UPDATE users 
       SET is_verified = $1, 
           verified_at = CASE WHEN $1 = true THEN NOW() ELSE NULL END,
           email_confirmed = $1
       WHERE user_id = $2`,
      [newStatus, userId]
    );
    
    return res.json({
      success: true,
      message: `User verification set to ${newStatus}`,
      is_verified: newStatus
    });
    
  } catch (error) {
    console.error('❌ Toggle verification error:', error);
    return res.status(500).json({ success: false, error: 'Failed to toggle verification' });
  }
});

// Admin: Parent Verification
router.post('/admin/parents/verify/:parentId', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { parentId } = req.params;
    const adminUserId = req.body.adminUserId || null;

    const parentResult = await pool.query(`
      SELECT p.*, u.email, u.username 
      FROM parents p
      JOIN users u ON p.user_id = u.user_id
      WHERE p.parent_id = $1
    `, [parentId]);

    if (!parentResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Parent not found'
      });
    }

    const parent = parentResult.rows[0];

    await pool.query(`
      UPDATE parents 
      SET is_verified = true,
          verified_at = NOW(),
          verified_by = $1,
          updated_at = NOW()
      WHERE parent_id = $2
    `, [adminUserId, parentId]);

    await pool.query(`
      UPDATE users 
      SET is_verified = true 
      WHERE user_id = $1
    `, [parent.user_id]);

    return res.json({
      success: true,
      message: 'Parent verified successfully',
      parent: {
        parent_id: parent.parent_id,
        full_name: parent.full_name,
        email: parent.email,
        is_verified: true,
        verified_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error verifying parent:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to verify parent'
    });
  }
});

// Admin: Deny Parent
router.post('/admin/parents/deny/:parentId', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { parentId } = req.params;
    const { reason } = req.body || {};
    const adminUserId = req.body.adminUserId || null;

    const parentResult = await pool.query(`
      SELECT p.*, u.email, u.username 
      FROM parents p
      JOIN users u ON p.user_id = u.user_id
      WHERE p.parent_id = $1
    `, [parentId]);

    if (!parentResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Parent not found'
      });
    }

    const parent = parentResult.rows[0];

    await pool.query(`
      UPDATE parents 
      SET is_active = false,
          is_verified = false,
          updated_at = NOW()
      WHERE parent_id = $1
    `, [parentId]);

    await pool.query(`
      UPDATE users 
      SET role = 'student',
          is_verified = false
      WHERE user_id = $1
    `, [parent.user_id]);

    return res.json({
      success: true,
      message: 'Parent access denied',
      parent: {
        parent_id: parent.parent_id,
        full_name: parent.full_name,
        email: parent.email,
        is_verified: false,
        is_active: false
      }
    });

  } catch (error) {
    console.error('❌ Error denying parent:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to deny parent'
    });
  }
});

console.log('✅ Admin routes registered successfully!');

/* ==========================================
   NETLIFY MOUNT & EXPORT ENGINE 🚀
========================================== */
app.use('/.netlify/functions/server', router);
app.use('/api', router);

const handler = serverless(app);
export { handler };

console.log('✅ HanVerse API v2.0.0 ready! 🐼');
console.log('📧 Email templates updated with HanVerse branding');
console.log('🔄 Session refresh, logout, and user-by-email endpoints added');
console.log('👪 Parent/Children endpoints fully functional');