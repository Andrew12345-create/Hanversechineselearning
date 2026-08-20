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
const jwt = require('jsonwebtoken');

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

function generateToken(length = 32, payload = {}) {
    const secret = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;

    if (!secret) {
        throw new Error('JWT_SECRET is not configured.');
    }

    return jwt.sign(
        payload,
        secret,
        {
            expiresIn: '8h'
        }
    );
}

function getFrontendBaseUrl() {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL.replace(/\/$/, '');
  if (process.env.URL) return process.env.URL.replace(/\/$/, '');
  return 'https://hanverse.netlify.app';
}

/* ==========================================
  EMAIL TEMPLATES 🐼
========================================== */
function getVerificationEmailHTML({ username, fullName, verifyLink }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to HanVerse! 🐼</title>
      <style>
        body {
          font-family: 'Comic Sans MS', 'Poppins', 'Segoe UI', Arial, sans-serif;
          background: #F0F7FF;
          margin: 0;
          padding: 20px;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 580px;
          margin: 0 auto;
          background: #FFFFFF;
          border-radius: 30px;
          padding: 40px 35px;
          box-shadow: 0 10px 40px rgba(37, 99, 235, 0.10);
          border: 2px solid #E0EEFF;
        }
        .header {
          text-align: center;
          margin-bottom: 25px;
        }
        .logo-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 4px;
        }
        .logo {
          font-size: 48px;
          background: #F0F7FF;
          padding: 10px;
          border-radius: 50%;
        }
        .brand {
          font-size: 32px;
          font-weight: 900;
          background: linear-gradient(135deg, #2563EB, #14B8A6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          letter-spacing: -1px;
        }
        .panda-badge {
          display: inline-block;
          background: #FEF3C7;
          padding: 4px 16px;
          border-radius: 20px;
          font-size: 14px;
          color: #D97706;
          font-weight: 700;
          margin-top: 4px;
        }
        .title {
          font-size: 28px;
          font-weight: 800;
          color: #1E293B;
          text-align: center;
          margin: 16px 0 10px;
          line-height: 1.2;
        }
        .title .highlight {
          color: #2563EB;
        }
        .subtitle {
          color: #475569;
          text-align: center;
          line-height: 1.8;
          font-size: 16px;
          margin-bottom: 24px;
        }
        .subtitle strong {
          color: #1E293B;
        }
        .button-container {
          text-align: center;
          margin: 28px 0 24px;
        }
        .button {
          display: inline-block;
          padding: 18px 48px;
          background: linear-gradient(135deg, #2563EB, #14B8A6);
          color: white !important;
          text-decoration: none;
          border-radius: 50px;
          font-weight: 700;
          font-size: 18px;
          transition: all 0.3s ease;
          box-shadow: 0 8px 25px rgba(37, 99, 235, 0.25);
          letter-spacing: 0.5px;
        }
        .button:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 35px rgba(37, 99, 235, 0.35);
        }
        .expiry {
          text-align: center;
          color: #64748B;
          font-size: 14px;
          margin-top: 8px;
        }
        .expiry strong {
          color: #F59E0B;
        }
        .divider {
          border: none;
          height: 2px;
          background: linear-gradient(to right, transparent, #DBEAFE, transparent);
          margin: 28px 0;
        }
        .features-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 12px;
          margin: 16px 0 24px;
        }
        .feature-item {
          text-align: center;
          padding: 14px 8px;
          background: #F8FAFC;
          border-radius: 16px;
          border: 1px solid #E2E8F0;
        }
        .feature-item .icon {
          font-size: 28px;
          display: block;
          margin-bottom: 4px;
        }
        .feature-item .label {
          font-size: 12px;
          font-weight: 600;
          color: #1E293B;
        }
        .info-box {
          background: #F0F7FF;
          border-radius: 16px;
          padding: 16px 20px;
          margin: 16px 0;
          border-left: 4px solid #2563EB;
        }
        .info-box p {
          margin: 4px 0;
          color: #1E293B;
          font-size: 14px;
        }
        .info-box .emoji {
          font-size: 18px;
        }
        .footer {
          text-align: center;
          color: #94A3B8;
          font-size: 13px;
          margin-top: 28px;
          padding-top: 24px;
          border-top: 2px solid #F1F5F9;
          line-height: 1.8;
        }
        .footer a {
          color: #2563EB;
          text-decoration: none;
          font-weight: 600;
        }
        .footer a:hover {
          text-decoration: underline;
        }
        .footer .social {
          font-size: 20px;
          margin: 8px 0;
          letter-spacing: 8px;
        }
        .footer .tagline {
          color: #94A3B8;
          font-size: 12px;
          font-style: italic;
        }
        @media (max-width: 480px) {
          .container { padding: 24px 18px; }
          .title { font-size: 22px; }
          .button { padding: 14px 32px; font-size: 16px; }
          .features-grid { grid-template-columns: 1fr 1fr; }
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
          <div class="panda-badge">✨ Your Mandarin Adventure Starts Here!</div>
        </div>
        <div class="title">
          Welcome to <span class="highlight">HanVerse</span>, ${fullName || username || 'Friend'}! 🎉
        </div>
        <div class="subtitle">
          You're just one click away from unlocking <strong>stories, games, and your AI Panda tutor</strong>!<br>
          Let's make learning Mandarin fun and exciting!
        </div>
        <div class="features-grid">
          <div class="feature-item">
            <span class="icon">📚</span>
            <span class="label">Stories</span>
          </div>
          <div class="feature-item">
            <span class="icon">🎮</span>
            <span class="label">Games</span>
          </div>
          <div class="feature-item">
            <span class="icon">🤖</span>
            <span class="label">AI Tutor</span>
          </div>
        </div>
        <div class="button-container">
          <a href="${verifyLink}" class="button">✅ Verify My Email</a>
        </div>
        <div class="expiry">
          ⏰ This link expires in <strong>24 hours</strong>
        </div>
        <hr class="divider">
        <div class="info-box">
          <p><span class="emoji">📧</span> <strong>${username || 'Your username'}</strong></p>
          <p><span class="emoji">🎯</span> Start at <strong>YCT 1</strong> and work your way up!</p>
          <p><span class="emoji">🏆</span> Earn <strong>XP</strong> and unlock achievements!</p>
        </div>
        <div class="footer">
          <p>Didn't create a HanVerse account? No worries — just ignore this email.</p>
          <p>💬 Need help? <a href="mailto:support@hanverse.com">support@hanverse.com</a></p>
          <div class="social">🐼 🎋 🏮 🎐</div>
          <p class="tagline">🐼 HanVerse — Learn Mandarin Through Stories, Games &amp; AI</p>
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
      <title>Reset Your HanVerse Password 🔐</title>
      <style>
        body {
          font-family: 'Comic Sans MS', 'Poppins', 'Segoe UI', Arial, sans-serif;
          background: #FFF7ED;
          margin: 0;
          padding: 20px;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 560px;
          margin: 0 auto;
          background: #FFFFFF;
          border-radius: 30px;
          padding: 40px 35px;
          box-shadow: 0 10px 40px rgba(245, 158, 11, 0.10);
          border: 2px solid #FED7AA;
        }
        .header {
          text-align: center;
          margin-bottom: 20px;
        }
        .logo-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 4px;
        }
        .logo {
          font-size: 48px;
          background: #FFF7ED;
          padding: 10px;
          border-radius: 50%;
        }
        .brand {
          font-size: 32px;
          font-weight: 900;
          background: linear-gradient(135deg, #2563EB, #14B8A6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          letter-spacing: -1px;
        }
        .security-badge {
          display: inline-block;
          background: #FEF3C7;
          padding: 4px 16px;
          border-radius: 20px;
          font-size: 14px;
          color: #D97706;
          font-weight: 700;
          margin-top: 4px;
        }
        .title {
          font-size: 26px;
          font-weight: 800;
          color: #1E293B;
          text-align: center;
          margin: 12px 0 8px;
          line-height: 1.2;
        }
        .title .highlight {
          color: #F59E0B;
        }
        .subtitle {
          color: #475569;
          text-align: center;
          line-height: 1.8;
          font-size: 16px;
          margin-bottom: 20px;
        }
        .subtitle strong {
          color: #1E293B;
        }
        .button-container {
          text-align: center;
          margin: 24px 0 16px;
        }
        .button {
          display: inline-block;
          padding: 18px 48px;
          background: linear-gradient(135deg, #F59E0B, #D97706);
          color: white !important;
          text-decoration: none;
          border-radius: 50px;
          font-weight: 700;
          font-size: 18px;
          transition: all 0.3s ease;
          box-shadow: 0 8px 25px rgba(245, 158, 11, 0.25);
          letter-spacing: 0.5px;
        }
        .button:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 35px rgba(245, 158, 11, 0.35);
        }
        .expiry {
          text-align: center;
          color: #64748B;
          font-size: 14px;
          margin-top: 8px;
        }
        .expiry strong {
          color: #EF4444;
        }
        .security-box {
          background: #FEF2F2;
          border-radius: 16px;
          padding: 16px 20px;
          margin: 16px 0;
          border: 2px solid #FECACA;
          border-left: 4px solid #EF4444;
        }
        .security-box p {
          margin: 4px 0;
          color: #991B1B;
          font-size: 14px;
          font-weight: 500;
        }
        .security-box .icon {
          font-size: 18px;
        }
        .divider {
          border: none;
          height: 2px;
          background: linear-gradient(to right, transparent, #FED7AA, transparent);
          margin: 24px 0;
        }
        .footer {
          text-align: center;
          color: #94A3B8;
          font-size: 13px;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 2px solid #F1F5F9;
          line-height: 1.8;
        }
        .footer a {
          color: #2563EB;
          text-decoration: none;
          font-weight: 600;
        }
        .footer a:hover {
          text-decoration: underline;
        }
        .footer .social {
          font-size: 20px;
          margin: 8px 0;
          letter-spacing: 8px;
        }
        .footer .tagline {
          color: #94A3B8;
          font-size: 12px;
          font-style: italic;
        }
        @media (max-width: 480px) {
          .container { padding: 24px 18px; }
          .title { font-size: 22px; }
          .button { padding: 14px 32px; font-size: 16px; }
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
          <div class="security-badge">🔒 Account Security</div>
        </div>
        <div class="title">
          Reset Your <span class="highlight">Password</span> 🔐
        </div>
        <div class="subtitle">
          Hi <strong>${fullName || username || 'Learner'}</strong>!<br>
          We received a request to reset your HanVerse password.
        </div>
        <div class="button-container">
          <a href="${resetLink}" class="button">🔄 Reset Password</a>
        </div>
        <div class="expiry">
          ⏰ This link expires in <strong>1 hour</strong>
        </div>
        <div class="security-box">
          <p><span class="icon">🛡️</span> <strong>Security Notice:</strong></p>
          <p style="font-weight: 400; color: #991B1B;">
            If you didn't request a password reset, just ignore this email.<br>
            Your account is safe and secure!
          </p>
        </div>
        <hr class="divider">
        <div class="footer">
          <p>💬 Need help? <a href="mailto:support@hanverse.com">support@hanverse.com</a></p>
          <div class="social">🐼 🎋 🏮 🎐</div>
          <p class="tagline">🐼 HanVerse — Learn Mandarin Through Stories, Games &amp; AI</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

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
          font-family: 'Comic Sans MS', 'Poppins', 'Segoe UI', Arial, sans-serif;
          background: #F0FDF4;
          margin: 0;
          padding: 20px;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 580px;
          margin: 0 auto;
          background: #FFFFFF;
          border-radius: 30px;
          padding: 40px 35px;
          box-shadow: 0 10px 40px rgba(20, 184, 166, 0.10);
          border: 2px solid #D1FAE5;
        }
        .header {
          text-align: center;
          margin-bottom: 20px;
        }
        .logo-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 4px;
        }
        .logo {
          font-size: 48px;
          background: #F0FDF4;
          padding: 10px;
          border-radius: 50%;
        }
        .brand {
          font-size: 32px;
          font-weight: 900;
          background: linear-gradient(135deg, #2563EB, #14B8A6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          letter-spacing: -1px;
        }
        .welcome-badge {
          display: inline-block;
          background: #FEF3C7;
          padding: 4px 16px;
          border-radius: 20px;
          font-size: 14px;
          color: #D97706;
          font-weight: 700;
          margin-top: 4px;
        }
        .title {
          font-size: 30px;
          font-weight: 800;
          color: #1E293B;
          text-align: center;
          margin: 12px 0 8px;
          line-height: 1.2;
        }
        .title .highlight {
          color: #14B8A6;
        }
        .subtitle {
          color: #475569;
          text-align: center;
          line-height: 1.8;
          font-size: 16px;
          margin-bottom: 20px;
        }
        .subtitle strong {
          color: #1E293B;
        }
        .welcome-message {
          background: #F0FDF4;
          border-radius: 16px;
          padding: 20px 24px;
          margin: 16px 0;
          border: 2px solid #D1FAE5;
          text-align: center;
        }
        .welcome-message .big-emoji {
          font-size: 36px;
          display: block;
          margin-bottom: 4px;
        }
        .welcome-message p {
          margin: 4px 0;
          color: #065F46;
          font-size: 15px;
          font-weight: 500;
        }
        .steps-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin: 20px 0;
        }
        .step-item {
          background: #F8FAFC;
          border-radius: 16px;
          padding: 16px 12px;
          text-align: center;
          border: 1px solid #E2E8F0;
          transition: all 0.2s ease;
        }
        .step-item .step-icon {
          font-size: 32px;
          display: block;
          margin-bottom: 6px;
        }
        .step-item .step-number {
          display: inline-block;
          background: #2563EB;
          color: white;
          font-size: 11px;
          font-weight: 700;
          padding: 1px 10px;
          border-radius: 10px;
          margin-bottom: 6px;
        }
        .step-item .step-text {
          font-size: 13px;
          font-weight: 600;
          color: #1E293B;
        }
        .step-item .step-desc {
          font-size: 11px;
          color: #64748B;
          margin-top: 2px;
        }
        .button-container {
          text-align: center;
          margin: 24px 0 16px;
        }
        .button {
          display: inline-block;
          padding: 18px 48px;
          background: linear-gradient(135deg, #14B8A6, #2563EB);
          color: white !important;
          text-decoration: none;
          border-radius: 50px;
          font-weight: 700;
          font-size: 18px;
          transition: all 0.3s ease;
          box-shadow: 0 8px 25px rgba(20, 184, 166, 0.25);
          letter-spacing: 0.5px;
        }
        .button:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 35px rgba(20, 184, 166, 0.35);
        }
        .bonus-box {
          text-align: center;
          background: #FEF3C7;
          border-radius: 16px;
          padding: 12px 20px;
          margin: 12px 0;
          border: 2px solid #FDE68A;
        }
        .bonus-box .bonus-text {
          font-weight: 700;
          color: #D97706;
          font-size: 15px;
        }
        .bonus-box .bonus-emoji {
          font-size: 20px;
        }
        .divider {
          border: none;
          height: 2px;
          background: linear-gradient(to right, transparent, #D1FAE5, transparent);
          margin: 24px 0;
        }
        .footer {
          text-align: center;
          color: #94A3B8;
          font-size: 13px;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 2px solid #F1F5F9;
          line-height: 1.8;
        }
        .footer a {
          color: #2563EB;
          text-decoration: none;
          font-weight: 600;
        }
        .footer a:hover {
          text-decoration: underline;
        }
        .footer .social {
          font-size: 20px;
          margin: 8px 0;
          letter-spacing: 8px;
        }
        .footer .tagline {
          color: #94A3B8;
          font-size: 12px;
          font-style: italic;
        }
        @media (max-width: 480px) {
          .container { padding: 24px 18px; }
          .title { font-size: 24px; }
          .button { padding: 14px 32px; font-size: 16px; }
          .steps-grid { grid-template-columns: 1fr; }
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
          <div class="welcome-badge">🎉 Welcome to the Family!</div>
        </div>
        <div class="title">
          Hey <span class="highlight">${fullName || username || 'Learner'}</span>! 👋
        </div>
        <div class="subtitle">
          You've joined a <strong>magical world</strong> where learning Mandarin is<br>
          fun, easy, and full of <strong>adventures</strong>! 🚀
        </div>
        <div class="welcome-message">
          <span class="big-emoji">🌟</span>
          <p><strong>Welcome to HanVerse!</strong></p>
          <p style="font-size: 14px; color: #065F46; font-weight: 400;">
            Get ready for an exciting journey of learning Mandarin through stories, games, and AI!
          </p>
        </div>
        <div class="steps-grid">
          <div class="step-item">
            <span class="step-icon">📝</span>
            <span class="step-number">STEP 1</span>
            <div class="step-text">Complete Your Profile</div>
            <div class="step-desc">Tell us about yourself</div>
          </div>
          <div class="step-item">
            <span class="step-icon">🎯</span>
            <span class="step-number">STEP 2</span>
            <div class="step-text">Take Placement Test</div>
            <div class="step-desc">Find your perfect level</div>
          </div>
          <div class="step-item">
            <span class="step-icon">📚</span>
            <span class="step-number">STEP 3</span>
            <div class="step-text">Start Your First Lesson</div>
            <div class="step-desc">Earn XP and level up!</div>
          </div>
          <div class="step-item">
            <span class="step-icon">🤖</span>
            <span class="step-number">STEP 4</span>
            <div class="step-text">Chat with Panda AI</div>
            <div class="step-desc">Your personal tutor!</div>
          </div>
        </div>
        <div class="bonus-box">
          <span class="bonus-emoji">🎁</span>
          <span class="bonus-text">Complete your first lesson today and earn 50 BONUS XP! ⚡</span>
        </div>
        <div class="button-container">
          <a href="${getFrontendBaseUrl()}/learn.html" class="button">🚀 Start Learning Now</a>
        </div>
        <hr class="divider">
        <div class="footer">
          <p>💬 Questions? We're here to help! <a href="mailto:support@hanverse.com">support@hanverse.com</a></p>
          <div class="social">🐼 🎋 🏮 🎐</div>
          <p class="tagline">🐼 HanVerse — Learn Mandarin Through Stories, Games &amp; AI</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function getInviteEmailHTML({ inviterName, customMessage, signupLink }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>You're Invited to HanVerse! 🐼</title>
      <style>
        body {
          font-family: 'Comic Sans MS', 'Poppins', 'Segoe UI', Arial, sans-serif;
          background: #F5F3FF;
          margin: 0;
          padding: 20px;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 580px;
          margin: 0 auto;
          background: #FFFFFF;
          border-radius: 30px;
          padding: 40px 35px;
          box-shadow: 0 10px 40px rgba(139, 92, 246, 0.10);
          border: 2px solid #DDD6FE;
        }
        .header {
          text-align: center;
          margin-bottom: 20px;
        }
        .logo-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 4px;
        }
        .logo {
          font-size: 48px;
          background: #F5F3FF;
          padding: 10px;
          border-radius: 50%;
        }
        .brand {
          font-size: 32px;
          font-weight: 900;
          background: linear-gradient(135deg, #8B5CF6, #6D28D9);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          letter-spacing: -1px;
        }
        .invite-badge {
          display: inline-block;
          background: #FEF3C7;
          padding: 4px 16px;
          border-radius: 20px;
          font-size: 14px;
          color: #D97706;
          font-weight: 700;
          margin-top: 4px;
        }
        .title {
          font-size: 28px;
          font-weight: 800;
          color: #1E293B;
          text-align: center;
          margin: 12px 0 8px;
          line-height: 1.2;
        }
        .title .highlight {
          color: #8B5CF6;
        }
        .subtitle {
          color: #475569;
          text-align: center;
          line-height: 1.8;
          font-size: 16px;
          margin-bottom: 16px;
        }
        .subtitle strong {
          color: #1E293B;
        }
        .invite-message {
          background: #F5F3FF;
          border-radius: 16px;
          padding: 16px 20px;
          margin: 12px 0;
          border-left: 4px solid #8B5CF6;
          font-style: italic;
          color: #4C1D95;
          font-size: 15px;
        }
        .perks-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin: 16px 0 20px;
        }
        .perk-item {
          text-align: center;
          padding: 14px 12px;
          background: #F8FAFC;
          border-radius: 16px;
          border: 1px solid #E2E8F0;
        }
        .perk-item .icon {
          font-size: 32px;
          display: block;
          margin-bottom: 4px;
        }
        .perk-item .label {
          font-size: 13px;
          font-weight: 600;
          color: #1E293B;
        }
        .bonus-box {
          text-align: center;
          background: #FEF3C7;
          border-radius: 16px;
          padding: 12px 20px;
          margin: 12px 0;
          border: 2px solid #FDE68A;
        }
        .bonus-box .bonus-text {
          font-weight: 700;
          color: #D97706;
          font-size: 15px;
        }
        .button-container {
          text-align: center;
          margin: 24px 0 16px;
        }
        .button {
          display: inline-block;
          padding: 18px 48px;
          background: linear-gradient(135deg, #8B5CF6, #6D28D9);
          color: white !important;
          text-decoration: none;
          border-radius: 50px;
          font-weight: 700;
          font-size: 18px;
          transition: all 0.3s ease;
          box-shadow: 0 8px 25px rgba(139, 92, 246, 0.25);
          letter-spacing: 0.5px;
        }
        .button:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 35px rgba(139, 92, 246, 0.35);
        }
        .divider {
          border: none;
          height: 2px;
          background: linear-gradient(to right, transparent, #DDD6FE, transparent);
          margin: 24px 0;
        }
        .footer {
          text-align: center;
          color: #94A3B8;
          font-size: 13px;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 2px solid #F1F5F9;
          line-height: 1.8;
        }
        .footer a {
          color: #8B5CF6;
          text-decoration: none;
          font-weight: 600;
        }
        .footer a:hover {
          text-decoration: underline;
        }
        .footer .social {
          font-size: 20px;
          margin: 8px 0;
          letter-spacing: 8px;
        }
        .footer .tagline {
          color: #94A3B8;
          font-size: 12px;
          font-style: italic;
        }
        @media (max-width: 480px) {
          .container { padding: 24px 18px; }
          .title { font-size: 22px; }
          .button { padding: 14px 32px; font-size: 16px; }
          .perks-grid { grid-template-columns: 1fr; }
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
          <div class="invite-badge">✨ You're Invited!</div>
        </div>
        <div class="title">
          <span class="highlight">${inviterName}</span> Invited You! 🎉
        </div>
        <div class="subtitle">
          Join the fun way to learn Mandarin through <strong>stories, games, and AI</strong>!<br>
          Your adventure starts here! 🚀
        </div>
        ${customMessage ? `<div class="invite-message">"${customMessage}"</div>` : ''}
        <div class="perks-grid">
          <div class="perk-item">
            <span class="icon">📚</span>
            <span class="label">Interactive Stories</span>
          </div>
          <div class="perk-item">
            <span class="icon">🎮</span>
            <span class="label">Fun Games</span>
          </div>
          <div class="perk-item">
            <span class="icon">🤖</span>
            <span class="label">AI Panda Tutor</span>
          </div>
          <div class="perk-item">
            <span class="icon">🏆</span>
            <span class="label">Achievements</span>
          </div>
        </div>
        <div class="bonus-box">
          <span class="bonus-text">🎁 Bonus: You'll both get <strong>50 XP</strong> when you sign up!</span>
        </div>
        <div class="button-container">
          <a href="${signupLink}" class="button">🎯 Join HanVerse Now</a>
        </div>
        <hr class="divider">
        <div class="footer">
          <p>Start your Mandarin adventure today! 🐼</p>
          <p style="font-size: 12px; color: #94A3B8;">
            This invitation was sent by a HanVerse member.
          </p>
          <div class="social">🐼 🎋 🏮 🎐</div>
          <p class="tagline">🐼 HanVerse — Learn Mandarin Through Stories, Games &amp; AI</p>
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

    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    
    if (parts.length !== 2) {
      return res.status(401).json({ success: false, error: 'Invalid token format.' });
    }
    
    const [userId, timestamp] = parts;
    const ts = parseInt(timestamp);
    
    if (isNaN(ts) || Date.now() - ts > 3600000) {
      return res.status(401).json({ success: false, error: 'Admin token expired or invalid.' });
    }
    
    const userResult = await pool.query(
      'SELECT is_admin FROM users WHERE user_id = $1',
      [userId]
    );
    
    if (!userResult.rows.length || !userResult.rows[0].is_admin) {
      return res.status(403).json({ success: false, error: 'Access denied. Admin privileges required.' });
    }
    
    req.adminUserId = userId;
    next();
  } catch (error) {
    console.error('❌ Admin auth error:', error);
    return res.status(500).json({ success: false, error: 'Authentication check failed.' });
  }
}

/* ==========================================
  AUTH ENDPOINTS 🔐
========================================== */

// SIGNUP 🚀
router.post('/signup', async (req, res) => {
  try {
    console.log('📥 Signup request received');
    
    if (!ensurePool(res)) return;

    const { username, full_name, email, password, role } = req.body || {};

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
          lessons_completed, achievements_count, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 0, 1, 0, false, false, false, false, $5, 0, 0, NOW(), NOW())
        RETURNING *`,
        [cleanUsername, cleanFullName, cleanEmail, password_hash, userRole]
      );
    } else {
      insertResult = await pool.query(
        `INSERT INTO users (
          username, full_name, email, password_hash, xp, level, streak_days, 
          is_admin, is_banned, is_verified, premium, 
          lessons_completed, achievements_count, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 0, 1, 0, false, false, false, false, 0, 0, NOW(), NOW())
        RETURNING *`,
        [cleanUsername, cleanFullName, cleanEmail, password_hash]
      );
    }

    const newUser = insertResult.rows[0];
    console.log('✅ User created with ID:', newUser.user_id);

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

// LOGIN 🔑
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

    await pool.query(
      `UPDATE users SET last_active = NOW(), updated_at = NOW() WHERE user_id = $1`,
      [user.user_id]
    );

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

// GET USER PROFILE
router.get('/user/:userId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { userId } = req.params;

    const result = await pool.query(
      `SELECT user_id, username, full_name, email, xp, level, streak_days, 
              profile_picture, is_admin, is_banned, banned_reason, is_verified, 
              premium, premium_until, current_yct, current_hsk, chinese_level, role,
              lessons_completed, achievements_count, age, parent_id
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

// SESSION REFRESH
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
    
    await pool.query(
      `UPDATE users SET last_active = NOW(), updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );
    
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

// LOGOUT
router.post('/auth/logout', async (req, res) => {
  return res.json({ success: true, message: 'Logged out successfully' });
});

// FIND USER BY EMAIL
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

// SEND VERIFICATION EMAIL
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

// RESEND VERIFICATION EMAIL
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

// VERIFY EMAIL (GET - for link click)
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

// VERIFY EMAIL (POST - for API)
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
      `UPDATE users SET is_verified = true, verified_at = NOW(), email_confirmed = true WHERE user_id = $1`,
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

// CHECK VERIFICATION STATUS
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

// FORGOT PASSWORD
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

// RESET PASSWORD
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

    if (String(newPassword).length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'The new password must contain at least 6 characters.' 
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

// PARENT PASSWORD VERIFICATION
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

// GET ALL CHILDREN FOR A PARENT
router.get('/parents/children/:parentId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { parentId } = req.params;

    const parentResult = await pool.query(
      `SELECT parent_id FROM parents WHERE user_id = $1`,
      [parentId]
    );

    if (!parentResult.rows.length) {
      return res.status(404).json({ 
        success: false, 
        error: 'Parent not found.' 
      });
    }

    const parentRecordId = parentResult.rows[0].parent_id;

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

// GET SINGLE CHILD BY ID
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

// ADD CHILD
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

// UPDATE CHILD
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
      `SELECT child_id FROM children WHERE child_id = $1 AND parent_id = (SELECT parent_id FROM parents WHERE user_id = $2)`,
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

// UPDATE CHILD PROGRESS
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

// GET CHILD ACTIVITIES
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

// GET PARENT ACTIVITY FEED
router.get('/parents/activity/:parentId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { parentId } = req.params;

    const parentResult = await pool.query(
      `SELECT parent_id FROM parents WHERE user_id = $1`,
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
        progress_id,
        user_id,
        course_type,
        course_level,
        lesson_id,
        completed,
        score,
        xp_earned,
        time_spent,
        attempts,
        quiz_answers,
        quiz_score,
        started_at,
        completed_at,
        created_at,
        updated_at
      FROM user_progress
      WHERE user_id = $1
        AND lesson_id = $2
      ORDER BY updated_at DESC
      LIMIT 1
    `, [userId, String(lessonId)]);

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
      completed: result.rows[0].completed === true
    });

  } catch (error) {
    console.error('❌ Progress fetch error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch progress'
    });
  }
});

// POST: Save or update user progress
router.post('/progress', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const body = req.body || {};
    const userId = body.userId ?? body.user_id;
    const lessonId = body.lessonId ?? body.lesson_id;
    const courseType = body.courseType ?? body.course_type ?? 'YCT';
    const courseLevel = Number(body.courseLevel ?? body.course_level ?? 1);
    const completed = body.completed === true || body.completed === 'true';
    const score = Number(body.score ?? 0);
    const xpEarned = Number(body.xpEarned ?? body.xp_earned ?? 0);
    const timeSpent = Number(body.timeSpent ?? body.time_spent ?? 0);
    const attempts = Math.max(1, Number(body.attempts ?? 1));
    const quizAnswers = body.quizAnswers ?? body.quiz_answers ?? null;
    const quizScore = Number(body.quizScore ?? body.quiz_score ?? 0);

    if (!userId || !lessonId) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Lesson ID are required'
      });
    }

    if (!Number.isInteger(courseLevel) || courseLevel < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid course level'
      });
    }

    const normalizedLessonId = String(lessonId);

    // Find existing progress
    const existing = await pool.query(`
      SELECT progress_id, completed
      FROM user_progress
      WHERE user_id = $1 AND lesson_id = $2
      LIMIT 1
    `, [userId, normalizedLessonId]);

    const existingProgress = existing.rows[0] || null;
    const wasAlreadyCompleted = existingProgress?.completed === true;

    let result;

    if (existingProgress) {
      result = await pool.query(`
        UPDATE user_progress
        SET
          course_type = $1,
          course_level = $2,
          completed = $3,
          score = $4,
          xp_earned = $5,
          time_spent = $6,
          attempts = GREATEST(COALESCE(attempts, 0) + 1, $7),
          quiz_answers = $8,
          quiz_score = $9,
          completed_at = CASE
            WHEN $3 = true AND completed_at IS NULL THEN NOW()
            ELSE completed_at
          END,
          updated_at = NOW()
        WHERE progress_id = $10
        RETURNING *
      `, [
        courseType,
        courseLevel,
        completed,
        score,
        xpEarned,
        timeSpent,
        attempts,
        quizAnswers,
        quizScore,
        existingProgress.progress_id
      ]);
    } else {
      result = await pool.query(`
        INSERT INTO user_progress (
          user_id,
          course_type,
          course_level,
          lesson_id,
          completed,
          score,
          xp_earned,
          time_spent,
          attempts,
          quiz_answers,
          quiz_score,
          started_at,
          completed_at,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, NOW(),
          CASE WHEN $5 = true THEN NOW() ELSE NULL END,
          NOW(),
          NOW()
        )
        RETURNING *
      `, [
        userId,
        courseType,
        courseLevel,
        normalizedLessonId,
        completed,
        score,
        xpEarned,
        timeSpent,
        attempts,
        quizAnswers,
        quizScore
      ]);
    }

    // Award XP and lesson completion only once
    if (completed && !wasAlreadyCompleted) {
      await pool.query(`
        UPDATE users
        SET
          xp = COALESCE(xp, 0) + $1,
          lessons_completed = COALESCE(lessons_completed, 0) + 1,
          last_lesson_at = NOW(),
          updated_at = NOW()
        WHERE user_id = $2
      `, [xpEarned, userId]);

      const userResult = await pool.query(`
        SELECT xp FROM users WHERE user_id = $1
      `, [userId]);

      if (userResult.rows.length) {
        const xp = Number(userResult.rows[0].xp) || 0;
        const newLevel = Math.floor(xp / 100) + 1;

        await pool.query(`
          UPDATE users
          SET level = $1
          WHERE user_id = $2 AND (level IS NULL OR level < $1)
        `, [newLevel, userId]);
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
      error: error.message || 'Failed to save progress'
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

    const [studentsResult, lessonsResult, gamesResult, satisfactionResult] = await Promise.all([
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
router.post('/sync/quizzes', async (req, res) => {
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
router.post('/sync/progress', async (req, res) => {
  try {
    if (!ensurePool(res)) return;
    
    const { userId, progress } = req.body;
    
    for (const item of progress) {
      const existing = await pool.query(`
        SELECT progress_id FROM user_progress 
        WHERE user_id = $1 AND lesson_id = $2
      `, [userId, item.lessonId]);
      
      if (existing.rows.length > 0) {
        await pool.query(`
          UPDATE user_progress 
          SET completed = $1, score = $2, xp_earned = $3, updated_at = NOW()
          WHERE user_id = $4 AND lesson_id = $5
        `, [item.completed, item.score, item.xpEarned, userId, item.lessonId]);
      } else {
        await pool.query(`
          INSERT INTO user_progress (user_id, lesson_id, completed, score, xp_earned, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        `, [userId, item.lessonId, item.completed, item.score, item.xpEarned]);
      }
    }
    
    res.json({ success: true, processed: progress.length });
  } catch (error) {
    console.error('Progress sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Sync XP
router.post('/sync/xp', async (req, res) => {
  try {
    if (!ensurePool(res)) return;
    
    const { userId, xp, entries } = req.body;
    
    await pool.query(`
      UPDATE users SET xp = xp + $1, updated_at = NOW() WHERE user_id = $2
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
router.post('/sync/achievements', async (req, res) => {
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
          UPDATE users SET achievements_count = achievements_count + 1, updated_at = NOW()
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
router.post('/sync/streak', async (req, res) => {
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
   USERS + PARENTS + LESSONS + MEDIA
========================================== */

/* =========================================================
   ADMIN AUTHENTICATION
========================================================= */

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

    const result = await pool.query(
      `SELECT *
       FROM users
       WHERE user_id = $1`,
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'User not found.'
      });
    }

    const user = result.rows[0];

    if (!user.is_admin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Administrator permissions are required.'
      });
    }

    const valid = await bcrypt.compare(
      adminPassword,
      user.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid admin password.'
      });
    }

const adminToken = generateToken(32, {
    user_id: user.user_id,
    email: user.email,
    role: 'admin',
    is_admin: true
});    

    return res.json({
      success: true,
      adminToken
    });

  } catch (error) {
    console.error('❌ Admin verification error:', error);

    return res.status(500).json({
      success: false,
      error: 'Admin validation failed.'
    });
  }
});


/* =========================================================
   ADMIN OVERVIEW / USERS
========================================================= */

router.get('/admin/overview', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const result = await pool.query(`
      SELECT *
      FROM users
      ORDER BY created_at DESC
    `);

    return res.json({
      success: true,
      users: result.rows.map(user => safeUser(user))
    });

  } catch (error) {
    console.error('❌ Admin overview error:', error);

    return res.status(500).json({
      success: false,
      error: 'Failed to load admin data.'
    });
  }
});


/* =========================================================
   ADMIN EMAIL BROADCAST
========================================================= */

router.post('/admin/email-all', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { subject, message } = req.body || {};

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        error: 'Subject and message are required.'
      });
    }

    const result = await pool.query(`
      SELECT email, username
      FROM users
      WHERE is_verified = true
        AND is_banned = false
        AND email IS NOT NULL
        AND email <> ''
      ORDER BY user_id
    `);

    let sent = 0;
    let failed = 0;

    for (const user of result.rows) {
      try {
        const html = `
          <div style="
            font-family:Arial,sans-serif;
            max-width:600px;
            margin:auto;
            padding:24px;
            color:#333;
          ">
            <div style="text-align:center;">
              <div style="font-size:48px;">🐼</div>
              <h2 style="color:#E63946;">
                ${subject}
              </h2>
            </div>

            <div style="
              margin-top:20px;
              line-height:1.7;
              white-space:pre-wrap;
            ">
              ${message}
            </div>

            <hr style="
              margin:28px 0;
              border:0;
              border-top:1px solid #eee;
            ">

            <p style="
              color:#777;
              font-size:13px;
              text-align:center;
            ">
              HanVerse — Learn Chinese. Have Fun. 🐼
            </p>
          </div>
        `;

        await sendEmail({
          to: user.email,
          subject,
          html
        });

        sent++;

      } catch (emailError) {
        failed++;

        console.error(
          `❌ Broadcast failed for ${user.email}:`,
          emailError
        );
      }
    }

    return res.json({
      success: true,
      sent,
      failed,
      total: result.rows.length
    });

  } catch (error) {
    console.error('❌ Broadcast error:', error);

    return res.status(500).json({
      success: false,
      error: 'Failed to send broadcast.'
    });
  }
});
/* =========================================================
   EMAIL CAMPAIGNS 📧
   Broadcast + scheduled + authenticated email sending
========================================================= */


/* ---------------------------------------------------------
   GET CAMPAIGNS
   GET /api/admin/email/campaigns
--------------------------------------------------------- */

router.get(
  '/admin/email/campaigns',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const { status } = req.query;

      const values = [];
      let where = '';

      if (status) {
        values.push(status);
        where = `WHERE ec.status = $1`;
      }

      const result = await pool.query(
        `
        SELECT
          ec.campaign_id,
          ec.campaign_type,
          ec.subject,
          ec.audience_type,
          ec.scheduled_for,
          ec.timezone,
          ec.status,
          ec.total_recipients,
          ec.sent_count,
          ec.failed_count,
          ec.created_at,
          ec.updated_at,
          ec.sent_at,

          sender.full_name AS sender_name,
          sender.username AS sender_username,
          sender.email AS sender_email,

          creator.full_name AS creator_name,
          creator.username AS creator_username

        FROM email_campaigns ec

        LEFT JOIN users sender
          ON sender.user_id = ec.sender_user_id

        LEFT JOIN users creator
          ON creator.user_id = ec.created_by

        ${where}

        ORDER BY ec.created_at DESC
        LIMIT 200
        `,
        values
      );

      return res.json({
        success: true,
        campaigns: result.rows
      });

    } catch (error) {
      console.error(
        '❌ Get email campaigns error:',
        error
      );

      return res.status(500).json({
        success: false,
        error: 'Failed to load email campaigns.'
      });
    }
  }
);


/* ---------------------------------------------------------
   CREATE CAMPAIGN
   POST /api/admin/email/campaigns
--------------------------------------------------------- */

router.post(
  '/admin/email/campaigns',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const {
        campaign_type = 'broadcast',
        audience_type = 'verified',
        subject,
        message,
        timing = 'now',
        scheduled_for = null,
        timezone = 'Africa/Nairobi',
        adminPassword
      } = req.body || {};

      /* ---------------------------------------------
         BASIC VALIDATION
      --------------------------------------------- */

      if (!subject || !String(subject).trim()) {
        return res.status(400).json({
          success: false,
          error: 'Email subject is required.'
        });
      }

      if (!message || !String(message).trim()) {
        return res.status(400).json({
          success: false,
          error: 'Email message is required.'
        });
      }

      if (!adminPassword) {
        return res.status(401).json({
          success: false,
          error: 'Administrator password is required.'
        });
      }

      if (
        !['broadcast', 'personal'].includes(
          campaign_type
        )
      ) {
        return res.status(400).json({
          success: false,
          error: 'Invalid campaign type.'
        });
      }

      if (
        ![
          'all',
          'verified',
          'students',
          'parents',
          'premium',
          'non_premium',
          'custom',
          'personal'
        ].includes(audience_type)
      ) {
        return res.status(400).json({
          success: false,
          error: 'Invalid audience type.'
        });
      }

      /* ---------------------------------------------
         VERIFY ADMIN ACCOUNT PASSWORD
      --------------------------------------------- */

      /*
       * verifyAdminToken should already have attached
       * the authenticated administrator to req.user.
       *
       * We also support req.userId as a fallback for
       * older versions of the authentication middleware.
       */

      const adminUserId =
        req.user?.user_id ||
        req.user?.id ||
        req.userId;

      if (!adminUserId) {
        return res.status(401).json({
          success: false,
          error: 'Administrator identity could not be determined.'
        });
      }

      const adminResult = await pool.query(
        `
        SELECT
          user_id,
          username,
          email,
          full_name,
          password_hash,
          is_admin,
          is_banned
        FROM users
        WHERE user_id = $1
        LIMIT 1
        `,
        [adminUserId]
      );

      if (!adminResult.rows.length) {
        return res.status(401).json({
          success: false,
          error: 'Administrator account not found.'
        });
      }

      const admin = adminResult.rows[0];

      if (!admin.is_admin) {
        return res.status(403).json({
          success: false,
          error: 'Administrator permissions are required.'
        });
      }

      if (admin.is_banned) {
        return res.status(403).json({
          success: false,
          error: 'This administrator account is banned.'
        });
      }

      const passwordValid =
        await bcrypt.compare(
          String(adminPassword),
          admin.password_hash
        );

      if (!passwordValid) {
        return res.status(401).json({
          success: false,
          error: 'Incorrect administrator password.'
        });
      }

      /* ---------------------------------------------
         DETERMINE SENDER
      --------------------------------------------- */

      const senderUserId = admin.user_id;

      /* ---------------------------------------------
         DETERMINE RECIPIENTS
      --------------------------------------------- */

      let recipientQuery = '';
      let recipientParams = [];

      switch (audience_type) {

        case 'all':

          recipientQuery = `
            SELECT
              user_id,
              email,
              full_name,
              username
            FROM users
            WHERE email IS NOT NULL
              AND email <> ''
              AND COALESCE(is_banned, false) = false
          `;

          break;


        case 'verified':

          recipientQuery = `
            SELECT
              user_id,
              email,
              full_name,
              username
            FROM users
            WHERE email IS NOT NULL
              AND email <> ''
              AND COALESCE(is_verified, false) = true
              AND COALESCE(is_banned, false) = false
          `;

          break;


        case 'students':

          recipientQuery = `
            SELECT
              user_id,
              email,
              full_name,
              username
            FROM users
            WHERE email IS NOT NULL
              AND email <> ''
              AND COALESCE(role, 'student') = 'student'
              AND COALESCE(is_banned, false) = false
          `;

          break;


        case 'parents':

          recipientQuery = `
            SELECT
              user_id,
              email,
              full_name,
              username
            FROM users
            WHERE email IS NOT NULL
              AND email <> ''
              AND COALESCE(role, '') = 'parent'
              AND COALESCE(is_banned, false) = false
          `;

          break;


        case 'premium':

          recipientQuery = `
            SELECT
              user_id,
              email,
              full_name,
              username
            FROM users
            WHERE email IS NOT NULL
              AND email <> ''
              AND COALESCE(premium, false) = true
              AND COALESCE(is_banned, false) = false
          `;

          break;


        case 'non_premium':

          recipientQuery = `
            SELECT
              user_id,
              email,
              full_name,
              username
            FROM users
            WHERE email IS NOT NULL
              AND email <> ''
              AND COALESCE(premium, false) = false
              AND COALESCE(is_banned, false) = false
          `;

          break;


        default:

          return res.status(400).json({
            success: false,
            error: 'This audience type is not yet supported.'
          });
      }


      const recipientsResult =
        await pool.query(
          recipientQuery,
          recipientParams
        );

      const recipients =
        recipientsResult.rows;


      if (!recipients.length) {
        return res.status(400).json({
          success: false,
          error: 'No eligible recipients were found.'
        });
      }


      /* ---------------------------------------------
         DETERMINE SEND TIME
      --------------------------------------------- */

      let scheduledDate;

      if (timing === 'now') {

        scheduledDate = new Date();

      } else if (timing === 'scheduled') {

        if (!scheduled_for) {
          return res.status(400).json({
            success: false,
            error:
              'scheduled_for is required when scheduling an email.'
          });
        }

        scheduledDate =
          new Date(scheduled_for);

        if (
          Number.isNaN(
            scheduledDate.getTime()
          )
        ) {
          return res.status(400).json({
            success: false,
            error: 'Invalid scheduled date/time.'
          });
        }

        if (
          scheduledDate.getTime() <=
          Date.now()
        ) {
          return res.status(400).json({
            success: false,
            error:
              'Scheduled time must be in the future.'
          });
        }

      } else {

        return res.status(400).json({
          success: false,
          error: 'Invalid timing option.'
        });
      }


      /* ---------------------------------------------
         CREATE CAMPAIGN
      --------------------------------------------- */

      await pool.query('BEGIN');

      const campaignResult =
        await pool.query(
          `
          INSERT INTO email_campaigns (
            campaign_type,
            subject,
            message,
            audience_type,
            sender_user_id,
            created_by,
            authorised_by,
            authorised_at,
            scheduled_for,
            timezone,
            status,
            total_recipients
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,NOW(),
            $8,$9,$10,$11
          )
          RETURNING *
          `,
          [
            campaign_type,
            String(subject).trim(),
            String(message).trim(),
            audience_type,
            senderUserId,
            adminUserId,
            adminUserId,
            scheduledDate,
            timezone,
            timing === 'now'
              ? 'processing'
              : 'scheduled',
            recipients.length
          ]
        );


      const campaign =
        campaignResult.rows[0];


      /* ---------------------------------------------
         INSERT RECIPIENTS
      --------------------------------------------- */

      for (const recipient of recipients) {

        await pool.query(
          `
          INSERT INTO email_campaign_recipients (
            campaign_id,
            user_id,
            email,
            recipient_name,
            status
          )
          VALUES ($1,$2,$3,$4,'pending')
          `,
          [
            campaign.campaign_id,
            recipient.user_id,
            recipient.email,
            recipient.full_name ||
              recipient.username ||
              null
          ]
        );
      }


      await pool.query('COMMIT');


      /* ---------------------------------------------
         SEND IMMEDIATELY
      --------------------------------------------- */

      if (timing === 'now') {

        /*
         * Do not keep the HTTP request waiting for
         * hundreds of emails.
         *
         * The campaign is already safely stored.
         * The scheduler/processor can pick it up.
         */

        return res.status(201).json({
          success: true,
          campaign,
          message:
            `Email campaign authorised and queued for ${recipients.length} recipient(s).`
        });
      }


      /* ---------------------------------------------
         SCHEDULED RESPONSE
      --------------------------------------------- */

      return res.status(201).json({
        success: true,
        campaign,
        message:
          `Campaign scheduled for ${scheduledDate.toISOString()}.`
      });

    } catch (error) {

      try {
        await pool.query('ROLLBACK');
      } catch (_) {}

      console.error(
        '❌ Create email campaign error:',
        error
      );

      return res.status(500).json({
        success: false,
        error:
          'Failed to create email campaign.'
      });
    }
  }
);


/* ---------------------------------------------------------
   CANCEL CAMPAIGN
   POST /api/admin/email/campaigns/:id/cancel
--------------------------------------------------------- */

router.post(
  '/admin/email/campaigns/:id/cancel',
  verifyAdminToken,
  async (req, res) => {

    try {

      if (!ensurePool(res)) return;

      const campaignId =
        Number(req.params.id);

      if (!Number.isInteger(campaignId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid campaign ID.'
        });
      }

      const result =
        await pool.query(
          `
          UPDATE email_campaigns
          SET
            status = 'cancelled',
            updated_at = NOW()
          WHERE campaign_id = $1
            AND status = 'scheduled'
          RETURNING *
          `,
          [campaignId]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error:
            'Campaign not found or can no longer be cancelled.'
        });
      }

      return res.json({
        success: true,
        campaign: result.rows[0],
        message: 'Campaign cancelled.'
      });

    } catch (error) {

      console.error(
        '❌ Cancel campaign error:',
        error
      );

      return res.status(500).json({
        success: false,
        error:
          'Failed to cancel campaign.'
      });
    }
  }
);

/* =========================================================
   ADMIN EMAIL INDIVIDUAL USER
========================================================= */

router.post(
  '/admin/users/email/:id',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const userId = Number(req.params.id);
      const { subject, message } = req.body || {};

      if (!Number.isInteger(userId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID.'
        });
      }

      if (!subject || !message) {
        return res.status(400).json({
          success: false,
          error: 'Subject and message are required.'
        });
      }

      const result = await pool.query(
        `SELECT email, username
         FROM users
         WHERE user_id = $1`,
        [userId]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'User not found.'
        });
      }

      const user = result.rows[0];

      const html = `
        <div style="
          font-family:Arial,sans-serif;
          max-width:600px;
          margin:auto;
          padding:24px;
        ">
          <div style="text-align:center;">
            <div style="font-size:48px;">🐼</div>
            <h2 style="color:#E63946;">
              ${subject}
            </h2>
          </div>

          <div style="
            margin-top:20px;
            line-height:1.7;
            white-space:pre-wrap;
          ">
            ${message}
          </div>

          <p style="
            margin-top:30px;
            text-align:center;
            color:#777;
            font-size:13px;
          ">
            HanVerse
          </p>
        </div>
      `;

      await sendEmail({
        to: user.email,
        subject,
        html
      });

      return res.json({
        success: true,
        message: 'Email sent successfully.'
      });

    } catch (error) {
      console.error('❌ Individual admin email error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to send email.'
      });
    }
  }
);


/* =========================================================
   ADMIN USER UPDATE
========================================================= */

router.post(
  '/admin/users/update/:id',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const userId = Number(req.params.id);

      if (!Number.isInteger(userId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID.'
        });
      }

      const {
        full_name,
        username,
        email,
        level,
        xp,
        role,
        is_banned,
        premium,
        is_verified,
        password
      } = req.body || {};

      const existing = await pool.query(
        `SELECT *
         FROM users
         WHERE user_id = $1`,
        [userId]
      );

      if (!existing.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'User not found.'
        });
      }

      const fields = [];
      const values = [];
      let index = 1;

      const addField = (name, value) => {
        fields.push(`${name} = $${index}`);
        values.push(value);
        index++;
      };

      if (full_name !== undefined) addField('full_name', full_name);
      if (username !== undefined) addField('username', username);
      if (email !== undefined) addField('email', email);
      if (level !== undefined) addField('level', Number(level) || 1);
      if (xp !== undefined) addField('xp', Number(xp) || 0);
      if (role !== undefined) addField('role', role);
      if (is_banned !== undefined) addField('is_banned', Boolean(is_banned));
      if (premium !== undefined) addField('premium', Boolean(premium));
      if (is_verified !== undefined) addField('is_verified', Boolean(is_verified));

      if (password && String(password).trim()) {
        const passwordHash = await bcrypt.hash(
          String(password),
          12
        );

        addField('password_hash', passwordHash);
      }

      if (!fields.length) {
        return res.status(400).json({
          success: false,
          error: 'No changes supplied.'
        });
      }

      fields.push('updated_at = NOW()');

      values.push(userId);

      const result = await pool.query(
        `UPDATE users
         SET ${fields.join(', ')}
         WHERE user_id = $${index}
         RETURNING *`,
        values
      );

      return res.json({
        success: true,
        user: safeUser(result.rows[0])
      });

    } catch (error) {
      console.error('❌ Admin user update error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to update user.'
      });
    }
  }
);


/* =========================================================
   ADMIN BAN / UNBAN USER
========================================================= */

router.post(
  '/admin/users/ban/:id',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const userId = Number(req.params.id);
      const { banned = true, reason = null } = req.body || {};

      if (!Number.isInteger(userId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID.'
        });
      }

      const result = await pool.query(
        `UPDATE users
         SET
           is_banned = $1,
           banned_reason = $2,
           updated_at = NOW()
         WHERE user_id = $3
         RETURNING *`,
        [Boolean(banned), reason, userId]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'User not found.'
        });
      }

      return res.json({
        success: true,
        user: safeUser(result.rows[0])
      });

    } catch (error) {
      console.error('❌ Admin ban error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to update ban status.'
      });
    }
  }
);


/* =========================================================
   ADMIN DELETE USER
========================================================= */

router.delete(
  '/admin/users/delete/:id',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const userId = Number(req.params.id);

      if (!Number.isInteger(userId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID.'
        });
      }

      const result = await pool.query(
        `DELETE FROM users
         WHERE user_id = $1
         RETURNING user_id`,
        [userId]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'User not found.'
        });
      }

      return res.json({
        success: true,
        message: 'User deleted successfully.'
      });

    } catch (error) {
      console.error('❌ Admin delete user error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to delete user.'
      });
    }
  }
);


/* =========================================================
   ADMIN TOGGLE VERIFICATION
========================================================= */

router.post(
  '/admin/toggle-verification/:userId',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const userId = Number(req.params.userId);

      if (!Number.isInteger(userId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID.'
        });
      }

      const requested =
        req.body?.verified !== undefined
          ? Boolean(req.body.verified)
          : null;

      let query;
      let params;

      if (requested === null) {
        query = `
          UPDATE users
          SET
            is_verified = NOT COALESCE(is_verified, false),
            verified_at =
              CASE
                WHEN NOT COALESCE(is_verified, false)
                THEN NOW()
                ELSE NULL
              END,
            updated_at = NOW()
          WHERE user_id = $1
          RETURNING *
        `;

        params = [userId];

      } else {
        query = `
          UPDATE users
          SET
            is_verified = $1,
            verified_at =
              CASE
                WHEN $1 = true
                THEN COALESCE(verified_at, NOW())
                ELSE NULL
              END,
            updated_at = NOW()
          WHERE user_id = $2
          RETURNING *
        `;

        params = [requested, userId];
      }

      const result = await pool.query(query, params);

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'User not found.'
        });
      }

      return res.json({
        success: true,
        user: safeUser(result.rows[0])
      });

    } catch (error) {
      console.error('❌ Verification toggle error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to update verification status.'
      });
    }
  }
);


/* =========================================================
   ADMIN PARENTS
========================================================= */

router.get(
  '/admin/parents',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const result = await pool.query(`
        SELECT
          p.*,
          u.username,
          u.email AS user_email,
          u.profile_picture,
          u.is_admin,
          (
            SELECT COUNT(*)
            FROM users c
            WHERE c.parent_id = p.parent_id
              AND c.role = 'student'
          ) AS actual_children_count
        FROM parents p
        LEFT JOIN users u
          ON u.user_id = p.user_id
        ORDER BY p.created_at DESC
      `);

      return res.json({
        success: true,
        parents: result.rows
      });

    } catch (error) {
      console.error('❌ Admin parents error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to fetch parents.'
      });
    }
  }
);


router.get(
  '/admin/parents/pending',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const result = await pool.query(`
        SELECT
          p.*,
          u.username,
          u.email
        FROM parents p
        LEFT JOIN users u
          ON u.user_id = p.user_id
        WHERE COALESCE(p.is_verified, false) = false
          AND COALESCE(p.is_active, true) = true
        ORDER BY p.created_at DESC
      `);

      return res.json({
        success: true,
        pendingParents: result.rows
      });

    } catch (error) {
      console.error('❌ Pending parents error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to fetch pending parents.'
      });
    }
  }
);


router.post(
  '/admin/parents/verify/:parentId',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const parentId = Number(req.params.parentId);

      const result = await pool.query(
        `UPDATE parents
         SET
           is_verified = true,
           verified_at = NOW(),
           is_active = true
         WHERE parent_id = $1
         RETURNING *`,
        [parentId]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'Parent not found.'
        });
      }

      return res.json({
        success: true,
        parent: result.rows[0]
      });

    } catch (error) {
      console.error('❌ Parent verification error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to verify parent.'
      });
    }
  }
);


router.post(
  '/admin/parents/deny/:parentId',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const parentId = Number(req.params.parentId);

      const result = await pool.query(
        `UPDATE parents
         SET
           is_verified = false,
           is_active = false
         WHERE parent_id = $1
         RETURNING *`,
        [parentId]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'Parent not found.'
        });
      }

      return res.json({
        success: true,
        parent: result.rows[0]
      });

    } catch (error) {
      console.error('❌ Parent denial error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to deny parent.'
      });
    }
  }
);


/* =========================================================
   =========================================================
   📚 ADMIN LESSON MANAGEMENT
   =========================================================
   ========================================================= */

/*
  IMPORTANT:

  These routes use the existing `lessons` table.

  Expected columns:

    lesson_id
    title
    description
    content
    level
    premium
    xp
    icon
    order_index
    vocabulary
    quiz
    learning_objectives
    is_published

  Media is supported through `lesson_media`.
*/


/* ---------------------------------------------------------
   GET ALL LESSONS
   /api/admin/lessons
--------------------------------------------------------- */

router.get(
  '/admin/lessons',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const result = await pool.query(`
        SELECT
          l.*,

          (
            SELECT COUNT(*)
            FROM lesson_media lm
            WHERE lm.lesson_id = l.lesson_id
          ) AS media_count

        FROM lessons l

        ORDER BY
          l.level ASC,
          l.order_index ASC,
          l.lesson_id ASC
      `);

      return res.json({
        success: true,
        lessons: result.rows
      });

    } catch (error) {
      console.error('❌ Admin lessons list error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to load lessons.'
      });
    }
  }
);


/* ---------------------------------------------------------
   GET ONE LESSON + ALL MEDIA
   /api/admin/lessons/:lessonId
--------------------------------------------------------- */

router.get(
  '/admin/lessons/:lessonId',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const lessonId = String(req.params.lessonId).trim();

      const lessonResult = await pool.query(
        `SELECT *
         FROM lessons
         WHERE lesson_id = $1`,
        [lessonId]
      );

      if (!lessonResult.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'Lesson not found.'
        });
      }

      const mediaResult = await pool.query(
        `SELECT *
         FROM lesson_media
         WHERE lesson_id = $1
         ORDER BY order_index ASC, media_id ASC`,
        [lessonId]
      );

      return res.json({
        success: true,
        lesson: lessonResult.rows[0],
        media: mediaResult.rows
      });

    } catch (error) {
      console.error('❌ Admin lesson detail error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to load lesson.'
      });
    }
  }
);


/* ---------------------------------------------------------
   CREATE LESSON
   /api/admin/lessons
--------------------------------------------------------- */

router.post(
  '/admin/lessons',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const {
        lesson_id,
        title,
        description = '',
        content = '',
        level = 1,
        premium = false,
        xp = 0,
        icon = '🐼',
        order_index = 1,
        vocabulary = [],
        quiz = [],
        learning_objectives = [],
        is_published = false
      } = req.body || {};

      if (!lesson_id || !title) {
        return res.status(400).json({
          success: false,
          error: 'lesson_id and title are required.'
        });
      }

      const result = await pool.query(
        `INSERT INTO lessons (
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
          learning_objectives,
          is_published
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
        )
        RETURNING *`,
        [
          String(lesson_id).trim(),
          String(title).trim(),
          description,
          content,
          Number(level) || 1,
          Boolean(premium),
          Number(xp) || 0,
          icon || '🐼',
          Number(order_index) || 1,
          JSON.stringify(vocabulary || []),
          JSON.stringify(quiz || []),
          JSON.stringify(learning_objectives || []),
          Boolean(is_published)
        ]
      );

      return res.status(201).json({
        success: true,
        lesson: result.rows[0]
      });

    } catch (error) {
      console.error('❌ Create lesson error:', error);

      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'A lesson with that lesson ID already exists.'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to create lesson.'
      });
    }
  }
);


/* ---------------------------------------------------------
   UPDATE LESSON
   /api/admin/lessons/:lessonId
--------------------------------------------------------- */

router.put(
  '/admin/lessons/:lessonId',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const lessonId = String(req.params.lessonId).trim();

      const {
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
        learning_objectives,
        is_published
      } = req.body || {};

      const result = await pool.query(
        `UPDATE lessons
         SET
           title = COALESCE($1, title),
           description = COALESCE($2, description),
           content = COALESCE($3, content),
           level = COALESCE($4, level),
           premium = COALESCE($5, premium),
           xp = COALESCE($6, xp),
           icon = COALESCE($7, icon),
           order_index = COALESCE($8, order_index),
           vocabulary = COALESCE($9, vocabulary),
           quiz = COALESCE($10, quiz),
           learning_objectives = COALESCE($11, learning_objectives),
           is_published = COALESCE($12, is_published)
         WHERE lesson_id = $13
         RETURNING *`,
        [
          title ?? null,
          description ?? null,
          content ?? null,
          level !== undefined ? Number(level) : null,
          premium !== undefined ? Boolean(premium) : null,
          xp !== undefined ? Number(xp) : null,
          icon ?? null,
          order_index !== undefined ? Number(order_index) : null,
          vocabulary !== undefined
            ? JSON.stringify(vocabulary)
            : null,
          quiz !== undefined
            ? JSON.stringify(quiz)
            : null,
          learning_objectives !== undefined
            ? JSON.stringify(learning_objectives)
            : null,
          is_published !== undefined
            ? Boolean(is_published)
            : null,
          lessonId
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'Lesson not found.'
        });
      }

      return res.json({
        success: true,
        lesson: result.rows[0]
      });

    } catch (error) {
      console.error('❌ Update lesson error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to update lesson.'
      });
    }
  }
);


/* ---------------------------------------------------------
   DELETE LESSON
   /api/admin/lessons/:lessonId
--------------------------------------------------------- */

router.delete(
  '/admin/lessons/:lessonId',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const lessonId = String(req.params.lessonId).trim();

      await pool.query('BEGIN');

      await pool.query(
        `DELETE FROM lesson_media
         WHERE lesson_id = $1`,
        [lessonId]
      );

      const result = await pool.query(
        `DELETE FROM lessons
         WHERE lesson_id = $1
         RETURNING lesson_id`,
        [lessonId]
      );

      if (!result.rows.length) {
        await pool.query('ROLLBACK');

        return res.status(404).json({
          success: false,
          error: 'Lesson not found.'
        });
      }

      await pool.query('COMMIT');

      return res.json({
        success: true,
        message: 'Lesson deleted successfully.'
      });

    } catch (error) {
      try {
        await pool.query('ROLLBACK');
      } catch (_) {}

      console.error('❌ Delete lesson error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to delete lesson.'
      });
    }
  }
);


/* =========================================================
   LESSON MEDIA
========================================================= */


/* ---------------------------------------------------------
   GET MEDIA
   /api/admin/lessons/:lessonId/media
--------------------------------------------------------- */

router.get(
  '/admin/lessons/:lessonId/media',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const lessonId = String(req.params.lessonId).trim();

      const result = await pool.query(
        `SELECT *
         FROM lesson_media
         WHERE lesson_id = $1
         ORDER BY order_index ASC, media_id ASC`,
        [lessonId]
      );

      return res.json({
        success: true,
        media: result.rows
      });

    } catch (error) {
      console.error('❌ Get lesson media error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to load lesson media.'
      });
    }
  }
);


/* ---------------------------------------------------------
   ADD MEDIA
   /api/admin/lessons/:lessonId/media
--------------------------------------------------------- */

router.post(
  '/admin/lessons/:lessonId/media',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const lessonId = String(req.params.lessonId).trim();

      const {
        media_type,
        media_url,
        title = '',
        caption = '',
        alt_text = '',
        poster_url = null,
        duration_seconds = null,
        order_index = 1,
        is_published = true
      } = req.body || {};

      if (!media_url) {
        return res.status(400).json({
          success: false,
          error: 'media_url is required.'
        });
      }

      if (!['image', 'video', 'audio'].includes(media_type)) {
        return res.status(400).json({
          success: false,
          error: 'media_type must be image, video or audio.'
        });
      }

      const lessonCheck = await pool.query(
        `SELECT lesson_id
         FROM lessons
         WHERE lesson_id = $1`,
        [lessonId]
      );

      if (!lessonCheck.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'Lesson not found.'
        });
      }

      const result = await pool.query(
        `INSERT INTO lesson_media (
          lesson_id,
          media_type,
          media_url,
          title,
          caption,
          alt_text,
          poster_url,
          duration_seconds,
          order_index,
          is_published
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        )
        RETURNING *`,
        [
          lessonId,
          media_type,
          media_url,
          title,
          caption,
          alt_text,
          poster_url,
          duration_seconds !== null
            ? Number(duration_seconds)
            : null,
          Number(order_index) || 1,
          Boolean(is_published)
        ]
      );

      return res.status(201).json({
        success: true,
        media: result.rows[0]
      });

    } catch (error) {
      console.error('❌ Add lesson media error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to add lesson media.'
      });
    }
  }
);


/* ---------------------------------------------------------
   UPDATE MEDIA
--------------------------------------------------------- */

router.put(
  '/admin/lessons/:lessonId/media/:mediaId',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const lessonId = String(req.params.lessonId).trim();
      const mediaId = Number(req.params.mediaId);

      const {
        media_type,
        media_url,
        title,
        caption,
        alt_text,
        poster_url,
        duration_seconds,
        order_index,
        is_published
      } = req.body || {};

      const result = await pool.query(
        `UPDATE lesson_media
         SET
           media_type = COALESCE($1, media_type),
           media_url = COALESCE($2, media_url),
           title = COALESCE($3, title),
           caption = COALESCE($4, caption),
           alt_text = COALESCE($5, alt_text),
           poster_url = COALESCE($6, poster_url),
           duration_seconds = COALESCE($7, duration_seconds),
           order_index = COALESCE($8, order_index),
           is_published = COALESCE($9, is_published),
           updated_at = NOW()
         WHERE media_id = $10
           AND lesson_id = $11
         RETURNING *`,
        [
          media_type ?? null,
          media_url ?? null,
          title ?? null,
          caption ?? null,
          alt_text ?? null,
          poster_url ?? null,
          duration_seconds !== undefined
            ? Number(duration_seconds)
            : null,
          order_index !== undefined
            ? Number(order_index)
            : null,
          is_published !== undefined
            ? Boolean(is_published)
            : null,
          mediaId,
          lessonId
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'Media item not found.'
        });
      }

      return res.json({
        success: true,
        media: result.rows[0]
      });

    } catch (error) {
      console.error('❌ Update media error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to update media.'
      });
    }
  }
);


/* ---------------------------------------------------------
   DELETE MEDIA
--------------------------------------------------------- */

router.delete(
  '/admin/lessons/:lessonId/media/:mediaId',
  verifyAdminToken,
  async (req, res) => {
    try {
      if (!ensurePool(res)) return;

      const lessonId = String(req.params.lessonId).trim();
      const mediaId = Number(req.params.mediaId);

      const result = await pool.query(
        `DELETE FROM lesson_media
         WHERE media_id = $1
           AND lesson_id = $2
         RETURNING media_id`,
        [mediaId, lessonId]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'Media item not found.'
        });
      }

      return res.json({
        success: true,
        message: 'Media deleted successfully.'
      });

    } catch (error) {
      console.error('❌ Delete media error:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to delete media.'
      });
    }
  }
);


/* =========================================================
   ADMIN ROUTE STATUS
========================================================= */

console.log('✅ Admin authentication routes registered');
console.log('✅ Admin user management routes registered');
console.log('✅ Admin parent management routes registered');
console.log('✅ Admin lesson management routes registered');
console.log('✅ Admin lesson media routes registered');
console.log('✅ Admin routes registered successfully!');

/* ==========================================
  NETLIFY MOUNT & EXPORT ENGINE 🚀
========================================== */
app.use('/api', router);
app.use('/.netlify/functions/server', router);

const handler = serverless(app);
export { handler };

console.log('✅ HanVerse API v2.0.0 ready! 🐼');
console.log('📧 Email templates updated with HanVerse branding');
console.log('🔄 Session refresh, logout, and user-by-email endpoints added');
console.log('👪 Parent/Children endpoints fully functional');
console.log('✅ All admin routes protected with verifyAdminToken middleware');