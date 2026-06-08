import serverless from 'serverless-http';
import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import bcrypt from 'bcrypt';
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
      'INSERT INTO users (username, email, password_hash, full_name, last_active) VALUES ($1,$2,$3,$4,CURRENT_DATE) RETURNING *',
      [username, email, passwordHash, fullName]
    );
    const user = result.rows[0];
    await pool.query('INSERT INTO user_settings (user_id) VALUES ($1)', [user.user_id]);

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
