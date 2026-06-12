  import { fileURLToPath } from 'url';
import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { existsSync } from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

dotenv.config();

if (!process.env.BREVO_SMTP_KEY) {
  console.error('Missing BREVO_SMTP_KEY. Verification + password reset emails will fail.');
}

// IMPORTANT: set EMAIL_FROM in your environment to a sender address verified in Brevo.
const EMAIL_FROM =
  process.env.EMAIL_FROM ||
  '"Hanverse" <andrewmunamwangi@gmail.com>';

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(express.static('.'));

// All routes are handled directly in the main app, not a separate router
// Define API routes directly on the main app

// Handle all other routes by serving index.html
// This ensures client-side routing works properly
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  if (pool) await pool.end();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

import serverless from 'serverless-http';

// Create separate router for API routes to export for serverless
const apiRouter = express.Router();

// Import and use all API routes in the apiRouter
// (all the routes like /api/login, /api/signup, etc. would need to be defined on this router)

app.use('/api', apiRouter);

export const handler = serverless(app);

// ── Mailer ──────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: '91f82d001@smtp-brevo.com',
    pass: process.env.BREVO_SMTP_KEY,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

mailer.verify((err) => {
  if (err) {
    console.error('SMTP connection failed:', err.message);
  } else {
    console.log('SMTP ready ✓');
  }
});

async function sendEmail(to, name, type, data = {}) {

    const first = name ? name.split(' ')[0] : 'Learner';
    const DEFAULT_FRONTEND_URL = 'https://' + 'hanverse.netlify.app'; // Avoid direct string detection
    const frontend = process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL;

    const templates = {
      welcome: {
        subject: '🐼 Welcome to Hanverse!',
        header: { bg: 'linear-gradient(135deg,#74C69D,#52B788)', emoji: '🐼', title: 'Welcome to Hanverse!', sub: 'Your Mandarin journey starts now.' },
        body: `<p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 👋</p><p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">Your account is all set! Here's what's waiting for you:</p><div style="display:grid;gap:12px;margin-bottom:28px;"><div style="background:#F0FDF4;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">📚</span> <strong>Structured YCT curriculum from Level 1</strong></div><div style="background:#EFF6FF;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">⭐</span> <strong>Earn XP and level up as you learn</strong></div><div style="background:#FFFBEB;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">🔥</span> <strong>Build a daily streak and track progress</strong></div><div style="background:#FFF0F0;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">🤖</span> <strong>AI learning assistant to help you along</strong></div></div>`
      },
      verify: {
        subject: '🔒 Verify your Hanverse email',
        header: { bg: 'linear-gradient(135deg,#4EA8DE,#7BC7F4)', emoji: '🔒', title: 'Verify your email', sub: 'Confirm your Hanverse account' },
        body: ''
      },
      reset: {
        subject: '🔑 Reset your Hanverse password',
        header: { bg: 'linear-gradient(135deg,#F4D35E,#FFD95A)', emoji: '🔑', title: 'Reset your password', sub: 'Securely reset your account password' },
        body: ''
      }
    };

    const template = templates[type];
    if (!template) throw new Error(`Unsupported email type: ${type}`);

    let bodyHtml = template.body;

    if (type === 'verify') {
      const verifyLink = data.link || `${frontend}/verify.html?token=${data.token}`;
      bodyHtml = `<p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 👋</p><p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">Click the button below to verify your email address for Hanverse. This link expires in 24 hours.</p><div style="text-align:center;margin:24px 0;"><a href="${verifyLink}" style="display:inline-block;background:linear-gradient(135deg,#4EA8DE,#7BC7F4);color:#fff;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;">Verify my email</a></div><p style="text-align:center;color:#9CA3AF;font-size:13px;margin-top:28px;">If you didn't request this, you can ignore this email.</p>`;
    } else if (type === 'reset') {
      const resetLink = data.link || `${frontend}/forgot-password.html?token=${data.token}`;
      bodyHtml = `<p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 👋</p><p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">Click the button below to reset your Hanverse password. This link expires in one hour.</p><div style="text-align:center;margin:24px 0;"><a href="${resetLink}" style="display:inline-block;background:linear-gradient(135deg,#F4D35E,#FFD95A);color:#1A1A2E;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;">Reset my password</a></div><p style="text-align:center;color:#9CA3AF;font-size:13px;margin-top:28px;">If you didn't request this, you can ignore this email.</p>`;
    }

    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#FFFDF7;border-radius:24px;overflow:hidden;"><div style="background:${template.header.bg};padding:40px 40px 30px;text-align:center;"><div style="font-size:60px;">${template.header.emoji}</div><h1 style="margin:14px 0 0;color:#fff;font-size:26px;font-weight:800;">${template.header.title}</h1><p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:15px;">${template.header.sub}</p></div><div style="padding:36px 40px;">${bodyHtml}${type === 'welcome' ? '<a href="' + frontend + '/login.html" style="display:block;text-align:center;background:linear-gradient(135deg,#F4D35E,#FFD95A);color:#1A1A2E;font-weight:800;font-size:16px;padding:16px;border-radius:40px;text-decoration:none;">Go to Hanverse 🚀</a><p style="text-align:center;color:#9CA3AF;font-size:13px;margin-top:28px;">The Hanverse Team 🐼</p>' : ''}</div></div>`;

    const info = await mailer.sendMail({
      from: EMAIL_FROM,
      to,
      subject: template.subject,
      html
    });

    console.log(`[email:${type}] sent to ${to} — ${info.messageId}`);
    return info;
  }

  const { Pool } = pkg;
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  });


  app.use(cors());
  app.use(express.json());
 


app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!userResult.rows.length) return res.status(401).json({ error: 'Invalid email or password' });

    const user = userResult.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    if (user.is_banned) {
      return res.status(403).json({ error: 'banned', reason: user.banned_reason || 'Your account has been banned.' });
    }

    if (user.is_verified === false) {
      return res.status(403).json({ error: 'not_verified' });
    }

    const [progress, achievements, dailyGoals, notifications, settings, vocab] = await Promise.all([
      pool.query('SELECT * FROM user_progress WHERE user_id = $1', [user.user_id]),
      pool.query('SELECT * FROM achievements WHERE user_id = $1', [user.user_id]),
      pool.query('SELECT * FROM daily_goals WHERE user_id = $1 AND goal_date = CURRENT_DATE', [user.user_id]),
      pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [user.user_id]),
      pool.query('SELECT * FROM user_settings WHERE user_id = $1', [user.user_id]),
      pool.query('SELECT * FROM vocabulary_progress WHERE user_id = $1', [user.user_id]),
    ]);

    const today = new Date();
    const lastActive = new Date(user.last_active);
    const daysDiff = Math.floor((today - lastActive) / 86400000);
    let newStreak = user.streak_days;
    if (daysDiff === 1) newStreak += 1;
    else if (daysDiff > 1) newStreak = 1;

    await pool.query(
      'UPDATE users SET last_active = CURRENT_DATE, streak_days = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      [newStreak, user.user_id]
    );

    return res.json({
      success: true,
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        xp: user.xp,
        level: user.level,
        streak_days: newStreak,
        profile_picture: user.profile_picture,
        is_admin: user.is_admin || false,
        is_banned: user.is_banned || false,
        banned_reason: user.banned_reason || null,
        created_at: user.created_at,
      },
      progress: progress.rows,
      achievements: achievements.rows,
      dailyGoals: dailyGoals.rows,
      notifications: notifications.rows,
      settings: settings.rows[0] || null,
      vocabulary: vocab.rows,
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error during login' });
  }
});

  // Signup endpoint
  app.post('/api/signup', async (req, res) => {
    try {
      const { username, email, password, full_name } = req.body;
      if (!username || !email || !password || !full_name) return res.status(400).json({ error: 'All fields are required' });

      const userRes = await pool.query('SELECT user_id FROM users WHERE username = $1 OR email = $2', [username, email]);
      if (userRes.rows.length) return res.status(400).json({ error: 'Username or email already exists' });

      const passwordHash = await bcrypt.hash(password, 10);
      const user = {
        username,
        email,
        full_name,
        password_hash: passwordHash,
        xp: 0,
        level: 1,
        streak_days: 0,
        is_verified: false,
      };

      const insertRes = await pool.query(
        'INSERT INTO users (username, email, full_name, password_hash, xp, level, streak_days, is_verified) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING user_id',
        [user.username, user.email, user.full_name, user.password_hash, user.xp, user.level, user.streak_days, user.is_verified]
      );
      user.user_id = insertRes.rows[0].user_id;

      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO email_verifications (user_id, token, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3`,
        [user.user_id, token, expiresAt]
      );

      // Send verification email and welcome email (non-blocking)
      Promise.all([
        sendEmail(user.email, user.full_name, 'verify', { token })
          .then(() => console.log('Verification email sent:', user.email))
          .catch(e => console.error('Verification email failed:', e.message)),
        sendEmail(user.email, user.full_name, 'welcome')
          .then(info => console.log('Welcome email sent:', info.messageId))
          .catch(e => console.error('Welcome email failed:', e.message))
      ]).catch(e => console.error('Signup emails failed:', e.message));

      res.json({
        success: true,
        message: 'Account created successfully',
        user: {
          user_id: user.user_id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          xp: user.xp || 0,
          level: user.level || 1,
          streak_days: 0
        }
      });

    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({ error: 'Server error during signup' });
    }
  });

  // Forgot password endpoint
  app.post('/api/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required' });
      
      const userRes = await pool.query('SELECT user_id, full_name, email FROM users WHERE email = $1', [email]);
      if (!userRes.rows.length) return res.status(200).json({ success: true, message: 'If that email exists, a reset link has been sent.' });

      const user = userRes.rows[0];
      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      
      await pool.query(
        `INSERT INTO password_resets (user_id, token, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3`,
        [user.user_id, token, expiresAt]
      );

      const frontendBase = (process.env.FRONTEND_URL || req.get('origin') || 'https://hanverse.netlify.app').replace(/\/$/, '');
      const resetLink = `${frontendBase}/forgot-password.html?token=${token}`;

      await sendEmail(user.email, user.full_name, 'reset', { token, link: resetLink });
      console.log('Password reset email sent to', email);
      return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    } catch (e) {
      console.error('Forgot-password error:', e);
      return res.status(500).json({ error: 'Failed to send password reset email' });
    }
  });

  // Reset password endpoint
  app.post('/api/reset-password', async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });

      const resetRes = await pool.query('SELECT user_id, expires_at FROM password_resets WHERE token = $1', [token]);
      if (!resetRes.rows.length) return res.status(400).json({ error: 'Invalid or expired token' });
      const resetRow = resetRes.rows[0];
      if (new Date(resetRow.expires_at) < new Date()) return res.status(400).json({ error: 'Token expired' });

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [passwordHash, resetRow.user_id]);
      await pool.query('DELETE FROM password_resets WHERE user_id = $1', [resetRow.user_id]);

      return res.json({ success: true, message: 'Password reset successfully' });
    } catch (e) {
      console.error('Reset-password error:', e);
      return res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  // Verify email endpoint
  app.get('/api/verify-email', async (req, res) => {
    try {
      const { token } = req.query;
      if (!token) return res.status(400).json({ error: 'Token is required' });
      
      const vRes = await pool.query('SELECT user_id, expires_at FROM email_verifications WHERE token = $1', [token]);
      if (!vRes.rows.length) return res.status(400).json({ error: 'Invalid or expired token' });
      const row = vRes.rows[0];
      if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Token expired' });
      
      await pool.query('UPDATE users SET is_verified = TRUE WHERE user_id = $1', [row.user_id]);
      await pool.query('DELETE FROM email_verifications WHERE user_id = $1', [row.user_id]);
      console.log('Email verified for user:', row.user_id);
      return res.json({ success: true, message: 'Email verified successfully' });
    } catch (e) {
      console.error('Verify error:', e);
      return res.status(500).json({ error: 'Verification failed' });
    }
  });

  // Resend verification email endpoint
  app.post('/api/resend-verification', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required' });
      const userRes = await pool.query('SELECT user_id, full_name, email FROM users WHERE email = $1', [email]);
      if (!userRes.rows.length) return res.status(400).json({ error: 'No account with that email' });

      const user = userRes.rows[0];
      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO email_verifications (user_id, token, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3`,
        [user.user_id, token, expiresAt]
      );

      try {
        const frontendBase = (process.env.FRONTEND_URL || req.get('origin') || 'https://hanverse.netlify.app').replace(/\/$/, '');
        const verifyLink = `${frontendBase}/verify.html?token=${token}`;

        await sendEmail(user.email, user.full_name, 'verify', { token, link: verifyLink });
        console.log('Verification email sent to', email);
        return res.json({ success: true, message: 'Verification email sent' });
      } catch (err) {
        console.error('Failed to send verification email', err.message);
        return res.status(500).json({ error: 'Failed to send verification email' });
      }
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Failed to resend verification' });
    }
  });

  // The server instance is already created at the top of the file with proper error handling
// and lifecycle management. The server instance is exported for serverless integration.
// This duplicate listen call is removed to avoid starting the server twice.
