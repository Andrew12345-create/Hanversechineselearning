import serverless from 'serverless-http';
import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const normalizeDatabaseUrl = (rawUrl) => {
  if (!rawUrl) return rawUrl;
  let url = rawUrl.trim();
  url = url.replace(/^psql\s+/i, '');
  url = url.replace(/^['"]|['"]$/g, '');
  return url;
};

const databaseUrl = normalizeDatabaseUrl(
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL
);
if (!databaseUrl) throw new Error('Missing DATABASE_URL');

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

// Ensure verification schema exists for serverless functions
(async () => {
  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE");
    await pool.query(`CREATE TABLE IF NOT EXISTS email_verifications (
      user_id INTEGER PRIMARY KEY,
      token TEXT,
      expires_at TIMESTAMPTZ
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS password_resets (
      user_id INTEGER PRIMARY KEY,
      token TEXT,
      expires_at TIMESTAMPTZ
    )`);
    console.log('Functions: email verification schema ready');
  } catch (e) {
    console.error('Functions: failed to ensure verification schema', e.message);
  }
})();

// Mailer for functions
const mailer = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: { user: '91f82d001@smtp-brevo.com', pass: process.env.BREVO_SMTP_KEY },
  tls: { rejectUnauthorized: false },
});

mailer.verify((err) => {
  if (err) console.error('Functions SMTP connection failed:', err.message);
  else console.log('Functions SMTP ready ✓');
});

async function sendEmail(to, name, type, data = {}) {
  const first = name ? name.split(' ')[0] : 'Learner';
  const frontend = process.env.FRONTEND_URL || 'https://hanverse.netlify.app';
  const templates = {
    welcome: {
      subject: '🐼 Welcome to Hanverse!',
      header: { bg: 'linear-gradient(135deg,#74C69D,#52B788)', emoji: '🐼', title: 'Welcome to Hanverse!', sub: 'Your Mandarin journey starts now.' },
      body: `<p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 👋</p><p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">Your account is all set! Here's what's waiting for you:</p><div style="display:grid;gap:12px;margin-bottom:28px;"><div style="background:#F0FDF4;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">📚</span> <strong>Structured YCT curriculum from Level 1</strong></div><div style="background:#EFF6FF;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">⭐</span> <strong>Earn XP and level up as you learn</strong></div><div style="background:#FFFBEB;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">🔥</span> <strong>Build a daily streak and track progress</strong></div><div style="background:#FFF0F0;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">🤖</span> <strong>AI learning assistant to help you along</strong></div></div>`,
    },
    verify: {
      subject: '🔒 Verify your Hanverse email',
      header: { bg: 'linear-gradient(135deg,#4EA8DE,#7BC7F4)', emoji: '🔒', title: 'Verify your email', sub: 'Confirm your Hanverse account' },
      body: '',
    },
    reset: {
      subject: '🔑 Reset your Hanverse password',
      header: { bg: 'linear-gradient(135deg,#F4D35E,#FFD95A)', emoji: '🔑', title: 'Reset your password', sub: 'Securely reset your account password' },
      body: '',
    },
  };

  const template = templates[type];
  if (!template) throw new Error(`Unsupported email type: ${type}`);

  let bodyHtml = template.body;
  if (type === 'verify') {
    const link = data.link || `${frontend}/verify.html?token=${data.token}`;
    bodyHtml = `<p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 👋</p><p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">Click the button below to verify your email address for Hanverse. This link expires in 24 hours.</p><div style="text-align:center;margin:24px 0;"><a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#4EA8DE,#7BC7F4);color:#fff;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;">Verify my email</a></div><p style="text-align:center;color:#9CA3AF;font-size:13px;margin-top:28px;">If you didn't request this, you can ignore this email.</p>`;
  }

  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#FFFDF7;border-radius:24px;overflow:hidden;"><div style="background:${template.header.bg};padding:40px 40px 30px;text-align:center;"><div style="font-size:60px;">${template.header.emoji}</div><h1 style="margin:14px 0 0;color:#fff;font-size:26px;font-weight:800;">${template.header.title}</h1><p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:15px;">${template.header.sub}</p></div><div style="padding:36px 40px;">${bodyHtml}${type === 'welcome' ? '<a href="https://hanverse.netlify.app/login.html" style="display:block;text-align:center;background:linear-gradient(135deg,#F4D35E,#FFD95A);color:#1A1A2E;font-weight:800;font-size:16px;padding:16px;border-radius:40px;text-decoration:none;">Go to Hanverse 🚀</a><p style="text-align:center;color:#9CA3AF;font-size:13px;margin-top:28px;">The Hanverse Team 🐼</p>' : ''}</div></div>`;

  const info = await mailer.sendMail({
    from: '"Hanverse" <andrewmunamwangi@gmail.com>',
    to,
    subject: template.subject,
    html,
  });

  console.log(`[functions:email:${type}] sent to ${to} — ${info.messageId}`);
  return info;
}

// Login
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

    res.json({
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
    console.error(e);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Signup
app.post('/api/signup', async (req, res) => {
  try {
    const { email, password, fullName, username } = req.body;
    if (!email || !password || !fullName || !username)
      return res.status(400).json({ error: 'All fields are required' });

    const existing = await pool.query(
      'SELECT 1 FROM users WHERE email = $1 OR username = $2', [email, username]
    );
    if (existing.rows.length) return res.status(400).json({ error: 'Email or username already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash, full_name, last_active, is_verified) VALUES ($1,$2,$3,$4,CURRENT_DATE,FALSE) RETURNING *',
      [username, email, passwordHash, fullName]
    );
    const user = result.rows[0];
    await pool.query('INSERT INTO user_settings (user_id) VALUES ($1)', [user.user_id]);

    // Generate and store verification token
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO email_verifications (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.user_id, token, expiresAt]
    );

    // Send verification email and welcome email (non-blocking)
    Promise.all([
      sendEmail(user.email, user.full_name, 'verify', { token })
        .then(() => console.log('Functions: verification email sent:', user.email))
        .catch(e => console.error('Functions: verification email failed:', e.message)),
      sendEmail(user.email, user.full_name, 'welcome')
        .then(info => console.log('Functions: welcome email sent:', info.messageId))
        .catch(e => console.error('Functions: welcome email failed:', e.message)),
    ]).catch((e) => console.error('Functions: signup emails failed:', e.message));

    res.json({
      success: true,
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        xp: 0,
        level: 1,
        streak_days: 0,
        is_admin: false,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error during signup' });
  }
});

// Resend verification email (minimal - checks email and returns JSON)
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
      await sendEmail(user.email, user.full_name, 'verify', { token });
      console.log('Functions: verification email sent to', email);
      return res.json({ success: true, message: 'Verification email sent' });
    } catch (err) {
      console.error('Functions: failed to send verification email', err.message);
      return res.status(500).json({ error: 'Failed to send verification email' });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to resend verification' });
  }
});

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

    await sendEmail(user.email, user.full_name, 'reset', { token });
    console.log('Functions: password reset email sent to', email);
    return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (e) {
    console.error('Functions: forgot-password error:', e);
    return res.status(500).json({ error: 'Failed to send password reset email' });
  }
});

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
    console.error('Functions: reset-password error:', e);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

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
    console.log('Functions: email verified for user:', row.user_id);
    return res.json({ success: true, message: 'Email verified successfully' });
  } catch (e) {
    console.error('Functions verify error:', e);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// Get user
app.get('/api/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const userResult = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });

    const user = userResult.rows[0];
    const [progress, achievements, notifications, settings, vocab] = await Promise.all([
      pool.query('SELECT * FROM user_progress WHERE user_id = $1', [userId]),
      pool.query('SELECT * FROM achievements WHERE user_id = $1', [userId]),
      pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [userId]),
      pool.query('SELECT * FROM user_settings WHERE user_id = $1', [userId]),
      pool.query('SELECT * FROM vocabulary_progress WHERE user_id = $1', [userId]),
    ]);

    res.json({
      user: {
        user_id: user.user_id,
        username: user.username,
        full_name: user.full_name,
        xp: user.xp,
        level: user.level,
        streak_days: user.streak_days,
        profile_picture: user.profile_picture,
        is_admin: user.is_admin || false,
        is_banned: user.is_banned || false,
        banned_reason: user.banned_reason || null,
        created_at: user.created_at,
      },
      progress: progress.rows,
      achievements: achievements.rows,
      notifications: notifications.rows,
      settings: settings.rows[0] || null,
      vocabulary: vocab.rows,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error fetching user data' });
  }
});

// Update profile picture
app.post('/api/user/:userId/pfp', async (req, res) => {
  try {
    const { userId } = req.params;
    const { profile_picture } = req.body;
    if (!profile_picture) return res.status(400).json({ error: 'No image provided' });
    await pool.query('UPDATE users SET profile_picture = $1 WHERE user_id = $2', [profile_picture, userId]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update profile picture' });
  }
});

// Ban / unban user
app.post('/api/admin/ban', async (req, res) => {
  try {
    const { adminPassword, userId, banned, reason } = req.body;
    if (adminPassword !== 'admin123') return res.status(401).json({ error: 'Wrong admin password' });
    await pool.query(
      'UPDATE users SET is_banned = $1, banned_reason = $2 WHERE user_id = $3',
      [banned, banned ? (reason || null) : null, userId]
    );
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ban action failed' }); }
});

// Admin edit row
app.post('/api/admin/edit', async (req, res) => {
  try {
    const { adminPassword, table, primaryValue, field, value } = req.body;
    if (adminPassword !== 'admin123') return res.status(401).json({ error: 'Wrong admin password' });
    const allowed = {
      users: { pk: 'user_id', editable: ['username','full_name','email','xp','level','streak_days','is_admin','is_banned','banned_reason','profile_picture'] },
      user_progress:       { pk: 'progress_id',     editable: ['completed','score','course_type','course_level','lesson_id'] },
      achievements:        { pk: 'achievement_id',  editable: ['achievement_type','achievement_name'] },
      daily_goals:         { pk: 'goal_id',         editable: ['target_lessons','completed_lessons','target_xp','earned_xp','completed'] },
      notifications:       { pk: 'notification_id', editable: ['title','message','type','is_read'] },
      vocabulary_progress: { pk: 'vocab_id',        editable: ['word','mastery_level','review_count'] },
      user_settings:       { pk: 'setting_id',      editable: ['daily_reminder','sound_enabled','notifications_enabled','language_preference','theme'] },
    };
    const cfg = allowed[table];
    if (!cfg) return res.status(400).json({ error: 'Invalid table' });
    if (!cfg.editable.includes(field)) return res.status(400).json({ error: 'Field not editable' });
    await pool.query(`UPDATE ${table} SET ${field} = $1 WHERE ${cfg.pk} = $2`, [value, primaryValue]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Edit failed' }); }
});

// Admin delete row
app.post('/api/admin/delete', async (req, res) => {
  try {
    const { adminPassword, table, primaryValue } = req.body;
    if (adminPassword !== 'admin123') return res.status(401).json({ error: 'Wrong admin password' });
    const pks = { users:'user_id', user_progress:'progress_id', achievements:'achievement_id', daily_goals:'goal_id', notifications:'notification_id', vocabulary_progress:'vocab_id', user_settings:'setting_id' };
    const pk = pks[table];
    if (!pk) return res.status(400).json({ error: 'Invalid table' });
    await pool.query(`DELETE FROM ${table} WHERE ${pk} = $1`, [primaryValue]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Delete failed' }); }
});

// Admin — create user
app.post('/api/admin/create-user', async (req, res) => {
  try {
    const { adminPassword, email, password, fullName, username, isAdmin } = req.body;
    if (adminPassword !== 'admin123') return res.status(401).json({ error: 'Wrong admin password' });

    if (!email || !password || !fullName || !username) {
      return res.status(400).json({ error: 'email, password, fullName, username are required' });
    }

    const existing = await pool.query(
      'SELECT 1 FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    if (existing.rows.length) return res.status(400).json({ error: 'Email or username already exists' });

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, last_active, is_admin)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, $5)
       RETURNING *`,
      [username, email, passwordHash, fullName, Boolean(isAdmin)]
    );

    const user = result.rows[0];

    // Ensure default settings exist
    await pool.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [user.user_id]);

    res.json({
      success: true,
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        xp: user.xp || 0,
        level: user.level || 1,
        streak_days: 0,
        is_admin: user.is_admin || false,
        is_banned: user.is_banned || false,
        banned_reason: user.banned_reason || null,
        created_at: user.created_at,
        profile_picture: user.profile_picture || null,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Create user failed' });
  }
});

// Admin overview
app.get('/api/admin/overview', async (req, res) => {
  try {
    const { userId } = req.query;
    const check = await pool.query('SELECT is_admin FROM users WHERE user_id = $1', [userId]);
    if (!check.rows.length || !check.rows[0].is_admin)
      return res.status(403).json({ error: 'Forbidden' });

    const [users, progress, achievements, goals, notifications, vocab, settings] = await Promise.all([
      pool.query('SELECT user_id,username,full_name,email,xp,level,streak_days,last_active,profile_picture,is_admin,is_banned,banned_reason,created_at FROM users ORDER BY created_at DESC'),
      pool.query('SELECT * FROM user_progress ORDER BY completed_at DESC NULLS LAST'),
      pool.query('SELECT * FROM achievements ORDER BY earned_at DESC'),
      pool.query('SELECT * FROM daily_goals ORDER BY goal_date DESC'),
      pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100'),
      pool.query('SELECT * FROM vocabulary_progress'),
      pool.query('SELECT * FROM user_settings'),
    ]);

    res.json({
      users: users.rows,
      progress: progress.rows,
      achievements: achievements.rows,
      daily_goals: goals.rows,
      notifications: notifications.rows,
      vocabulary: vocab.rows,
      settings: settings.rows,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});


// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/health/db', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch (e) { res.status(503).json({ ok: false }); }
});

export const handler = serverless(app);
