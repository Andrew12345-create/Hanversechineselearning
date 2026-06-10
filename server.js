import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { existsSync } from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';

dotenv.config();

const { Pool } = pkg;
const app = express();

const isMobileOrTablet = (userAgent = '') => /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|tablet|kindle|silk|playbook/i.test(userAgent);
const tryServeAppVersion = (req, res, next) => {
  if (req.method !== 'GET') return next();
  const ua = req.headers['user-agent'] || '';
  if (!isMobileOrTablet(ua)) return next();

  const originalPath = req.path;
  if (originalPath === '/' || originalPath === '/index.html') {
    req.url = '/index-app.html';
    return next();
  }

  if (originalPath.endsWith('.html') && !originalPath.endsWith('-app.html')) {
    const appVersionPath = originalPath.replace(/\.html$/, '-app.html');
    const appFile = path.join(process.cwd(), appVersionPath);
    if (existsSync(appFile)) {
      req.url = appVersionPath;
    }
  }

  return next();
};

// Middleware
app.use(tryServeAppVersion);
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Database connection pool
const normalizeDatabaseUrl = (rawUrl) => {
  if (!rawUrl) return rawUrl;
  let url = rawUrl.trim();
  url = url.replace(/^psql\s+/i, '');
  url = url.replace(/^['"]|['"]$/g, '');
  return url;
};

const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL || process.env.eDATABASE_URL || process.env.NEON_DATABASE_URL);
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Set it in .env for local development or in Netlify environment variables.');
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    // Neon requires SSL; connection string already includes sslmode=require&channel_binding=require.
    rejectUnauthorized: false,
  },
});


// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err.stack);
  } else {
    console.log('Database connected successfully');
    release();
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Get user from database
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];

    // Verify password (using bcrypt for comparison)
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.is_banned) {
      return res.status(403).json({ error: 'banned', reason: user.banned_reason || 'Your account has been banned.' });
    }

    // Fetch all related user data
    const progressResult = await pool.query(
      'SELECT * FROM user_progress WHERE user_id = $1',
      [user.user_id]
    );

    const achievementsResult = await pool.query(
      'SELECT * FROM achievements WHERE user_id = $1',
      [user.user_id]
    );

    const dailyGoalsResult = await pool.query(
      'SELECT * FROM daily_goals WHERE user_id = $1 AND goal_date = CURRENT_DATE',
      [user.user_id]
    );

    const notificationsResult = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [user.user_id]
    );

    const settingsResult = await pool.query(
      'SELECT * FROM user_settings WHERE user_id = $1',
      [user.user_id]
    );

    const vocabResult = await pool.query(
      'SELECT * FROM vocabulary_progress WHERE user_id = $1',
      [user.user_id]
    );

    // Update last_active and streak
    const today = new Date();
    const lastActive = new Date(user.last_active);
    const daysDiff = Math.floor((today - lastActive) / (1000 * 60 * 60 * 24));

    let newStreak = user.streak_days;
    if (daysDiff === 1) {
      newStreak += 1;
      sendEmail(user.email, user.full_name, 'streak', { streak: newStreak }).catch(e => console.error('Streak email failed:', e.message));
    } else if (daysDiff > 1) {
      newStreak = 1;
    }

    // Update user (no login XP - users earn XP through lessons)
    await pool.query(
      `UPDATE users 
       SET last_active = CURRENT_DATE, streak_days = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [newStreak, user.user_id]
    );

    // Return all user data (no bonus XP on login)
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
        created_at: user.created_at
      },
      progress: progressResult.rows,
      achievements: achievementsResult.rows,
      dailyGoals: dailyGoalsResult.rows,
      notifications: notificationsResult.rows,
      settings: settingsResult.rows[0] || null,
      vocabulary: vocabResult.rows
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Signup endpoint
app.post('/api/signup', async (req, res) => {
  try {
    const { email, password, fullName, username } = req.body;

    if (!email || !password || !fullName || !username) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email or username already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, last_active)
       VALUES ($1, $2, $3, $4, CURRENT_DATE)
       RETURNING *`,
      [username, email, passwordHash, fullName]
    );

    const user = result.rows[0];

    // Create default settings
    await pool.query(
      `INSERT INTO user_settings (user_id)
       VALUES ($1)`,
      [user.user_id]
    );

    // Send welcome email (non-blocking)
    sendWelcomeEmail(user.email, user.full_name)
      .then(info => console.log('Welcome email sent:', info.messageId))
      .catch(e => console.error('Welcome email failed:', e.message));

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

// Welcome email
const mailer = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: '91f82d001@smtp-brevo.com',
    pass: process.env.BREVO_SMTP_KEY,
  },
  tls: { rejectUnauthorized: false },
});

mailer.verify((err) => {
  if (err) console.error('SMTP connection failed:', err.message);
  else console.log('SMTP ready ✓');
});

async function sendWelcomeEmail(to, name) {
  return sendEmail(to, name, 'welcome');
}

async function sendEmail(to, name, type, data = {}) {
  const first = name ? name.split(' ')[0] : 'Learner';

  const templates = {
    welcome: {
      subject: '🐼 Welcome to Hanverse!',
      header: { bg: 'linear-gradient(135deg,#74C69D,#52B788)', emoji: '🐼', title: 'Welcome to Hanverse!', sub: 'Your Mandarin journey starts now.' },
      body: `
        <p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 👋</p>
        <p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">Your account is all set! Here's what's waiting for you:</p>
        <div style="display:grid;gap:12px;margin-bottom:28px;">
          <div style="background:#F0FDF4;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">📚</span> <strong>Structured YCT curriculum from Level 1</strong></div>
          <div style="background:#EFF6FF;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">⭐</span> <strong>Earn XP and level up as you learn</strong></div>
          <div style="background:#FFFBEB;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">🔥</span> <strong>Build a daily streak and track progress</strong></div>
          <div style="background:#FFF0F0;border-radius:14px;padding:14px 18px;"><span style="font-size:20px;">🤖</span> <strong>AI learning assistant to help you along</strong></div>
        </div>`,
    },
    admin: {
      subject: '👑 You are now a Hanverse Administrator!',
      header: { bg: 'linear-gradient(135deg,#ff416c,#ff4b2b)', emoji: '👑', title: 'Admin Access Granted!', sub: 'You now have full administrator privileges.' },
      body: `
        <p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 👋</p>
        <p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">You have been granted <strong>Administrator</strong> access on Hanverse. You can now manage users, content, and platform settings.</p>
        <div style="background:#FFF0F0;border-radius:14px;padding:18px 20px;margin-bottom:28px;border-left:4px solid #ff416c;">
          <p style="margin:0;color:#1A1A2E;font-weight:600;">⚠️ With great power comes great responsibility. Please use your admin access carefully.</p>
        </div>`,
    },
    levelup: {
      subject: `⬆️ You reached Level ${data.level} on Hanverse!`,
      header: { bg: 'linear-gradient(135deg,#4EA8DE,#7BC7F4)', emoji: '⬆️', title: `Level ${data.level} Reached!`, sub: 'Your Mandarin is seriously growing 🚀' },
      body: `
        <p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 🎉</p>
        <p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">You just levelled up to <strong style="color:#4EA8DE;font-size:1.1em;">Level ${data.level}</strong>! Keep pushing — the next level is waiting.</p>
        <div style="background:#EFF6FF;border-radius:14px;padding:18px 20px;margin-bottom:28px;text-align:center;">
          <div style="font-size:52px;">🏆</div>
          <p style="margin:8px 0 0;font-size:1.4rem;font-weight:800;color:#4EA8DE;">Level ${data.level}</p>
        </div>`,
    },
    streak: {
      subject: `🔥 ${data.streak}-Day Streak on Hanverse!`,
      header: { bg: 'linear-gradient(135deg,#F4D35E,#FFD95A)', emoji: '🔥', title: `${data.streak}-Day Streak!`, sub: 'You are on fire — keep it going!' },
      body: `
        <p style="font-size:17px;color:#1A1A2E;margin:0 0 16px;">Hey <strong>${first}</strong> 🔥</p>
        <p style="color:#6B7280;line-height:1.8;margin:0 0 24px;">You have logged in <strong>${data.streak} days in a row</strong>! Consistency is the secret to mastering Mandarin.</p>
        <div style="background:#FFFBEB;border-radius:14px;padding:18px 20px;margin-bottom:28px;text-align:center;">
          <div style="font-size:52px;">🔥</div>
          <p style="margin:8px 0 0;font-size:1.4rem;font-weight:800;color:#D4A800;">${data.streak} Days Strong!</p>
        </div>`,
    },
  };

  const t = templates[type];
  if (!t) return;

  const info = await mailer.sendMail({
    from: '"Hanverse" <andrewmunamwangi@gmail.com>',
    to,
    subject: t.subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#FFFDF7;border-radius:24px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.08);">
        <div style="background:${t.header.bg};padding:40px 40px 30px;text-align:center;">
          <div style="font-size:60px;">${t.header.emoji}</div>
          <h1 style="margin:14px 0 0;color:#fff;font-size:26px;font-weight:800;">${t.header.title}</h1>
          <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:15px;">${t.header.sub}</p>
        </div>
        <div style="padding:36px 40px;">
          ${t.body}
          <a href="https://hanverse.netlify.app/login.html" style="display:block;text-align:center;background:linear-gradient(135deg,#F4D35E,#FFD95A);color:#1A1A2E;font-weight:800;font-size:16px;padding:16px;border-radius:40px;text-decoration:none;">Go to Hanverse 🚀</a>
          <p style="text-align:center;color:#9CA3AF;font-size:13px;margin-top:28px;">The Hanverse Team 🐼</p>
        </div>
      </div>`,
  });
  console.log(`[email:${type}] sent to ${to} — ${info.messageId}`);
  return info;
}

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

    // Trigger emails on specific field changes
    if (table === 'users') {
      const userRes = await pool.query('SELECT email, full_name, level FROM users WHERE user_id = $1', [primaryValue]);
      const u = userRes.rows[0];
      if (u) {
        if (field === 'is_admin' && (value === 'true' || value === true || value === '1')) {
          sendEmail(u.email, u.full_name, 'admin').catch(e => console.error('Admin email failed:', e.message));
        }
        if (field === 'level') {
          sendEmail(u.email, u.full_name, 'levelup', { level: value }).catch(e => console.error('Level email failed:', e.message));
        }
      }
    }

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

// Admin — full DB overview (admin only)
app.get('/api/admin/overview', async (req, res) => {
  try {
    const { userId } = req.query;
    const check = await pool.query('SELECT is_admin FROM users WHERE user_id = $1', [userId]);
    if (!check.rows.length || !check.rows[0].is_admin) return res.status(403).json({ error: 'Forbidden' });

    const [users, progress, achievements, goals, notifications, vocab, settings] = await Promise.all([
      pool.query('SELECT user_id,username,full_name,email,xp,level,streak_days,last_active,is_admin,is_banned,banned_reason,created_at FROM users ORDER BY created_at DESC'),
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

// Health endpoint (DB connectivity check)
app.get('/api/health/db', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true });
  } catch (e) {
    console.error('DB health check failed:', e);
    return res.status(503).json({ ok: false, error: 'Database connection failed' });
  }
});

// Get user data endpoint
app.get('/api/user/:userId', async (req, res) => {

  try {
    const { userId } = req.params;

    const userResult = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    const progressResult = await pool.query(
      'SELECT * FROM user_progress WHERE user_id = $1',
      [userId]
    );

    const achievementsResult = await pool.query(
      'SELECT * FROM achievements WHERE user_id = $1',
      [userId]
    );

    const notificationsResult = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [userId]
    );

    const settingsResult = await pool.query(
      'SELECT * FROM user_settings WHERE user_id = $1',
      [userId]
    );

    const vocabResult = await pool.query(
      'SELECT * FROM vocabulary_progress WHERE user_id = $1',
      [userId]
    );

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
        created_at: user.created_at
      },
      progress: progressResult.rows,
      achievements: achievementsResult.rows,
      notifications: notificationsResult.rows,
      settings: settingsResult.rows[0],
      vocabulary: vocabResult.rows
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Server error fetching user data' });
  }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

