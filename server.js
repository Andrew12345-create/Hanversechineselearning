import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { existsSync } from 'fs';
import path from 'path';

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

// Admin — full DB overview (admin only)
app.get('/api/admin/overview', async (req, res) => {
  try {
    const { userId } = req.query;
    const check = await pool.query('SELECT is_admin FROM users WHERE user_id = $1', [userId]);
    if (!check.rows.length || !check.rows[0].is_admin) return res.status(403).json({ error: 'Forbidden' });

    const [users, progress, achievements, goals, notifications, vocab, settings] = await Promise.all([
      pool.query('SELECT user_id,username,full_name,email,xp,level,streak_days,last_active,is_admin,created_at FROM users ORDER BY created_at DESC'),
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

