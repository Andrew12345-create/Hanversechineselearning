const express = require('express');
const pkg = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');

const { Pool } = pkg;
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
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

    // Award login XP
    const newXp = user.xp + 10;
    let newLevel = user.level;
    if (newXp >= user.level * 100) {
      newLevel += 1;
    }

    // Update user
    await pool.query(
      `UPDATE users 
       SET last_active = CURRENT_DATE, streak_days = $1, xp = $2, level = $3, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $4`,
      [newStreak, newXp, newLevel, user.user_id]
    );

    // Return all user data
    res.json({
      success: true,
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        xp: newXp,
        level: newLevel,
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

    res.json({
      user,
      progress: progressResult.rows,
      achievements: achievementsResult.rows,
      notifications: notificationsResult.rows,
      settings: settingsResult.rows[0]
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Server error fetching user data' });
  }
});

// Export handler for Netlify Functions
exports.handler = async (event, context) => {
  // Add CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Parse the path to route to the correct handler
    const path = event.path.replace('/.netlify/functions/server', '');
    
    // Simple routing based on path and method
    if (path === '/api/login' && event.httpMethod === 'POST') {
      req = JSON.parse(event.body);
      // Re-run the login logic
      const { email, password } = req;
      
      if (!email || !password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Email and password are required' })
        };
      }

      const userResult = await pool.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );

      if (userResult.rows.length === 0) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Invalid email or password' })
        };
      }

      const user = userResult.rows[0];
      const passwordMatch = await bcrypt.compare(password, user.password_hash);

      if (!passwordMatch) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Invalid email or password' })
        };
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

      const newXp = user.xp + 10;
      let newLevel = user.level;
      if (newXp >= user.level * 100) {
        newLevel += 1;
      }

      await pool.query(
        `UPDATE users 
         SET last_active = CURRENT_DATE, streak_days = $1, xp = $2, level = $3, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $4`,
        [newStreak, newXp, newLevel, user.user_id]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          user: {
            user_id: user.user_id,
            username: user.username,
            email: user.email,
            full_name: user.full_name,
            xp: newXp,
            level: newLevel,
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
        })
      };
    }

    if (path === '/api/signup' && event.httpMethod === 'POST') {
      const { email, password, fullName, username } = JSON.parse(event.body);
      
      if (!email || !password || !fullName || !username) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'All fields are required' })
        };
      }

      const existingUser = await pool.query(
        'SELECT * FROM users WHERE email = $1 OR username = $2',
        [email, username]
      );

      if (existingUser.rows.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Email or username already exists' })
        };
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const result = await pool.query(
        `INSERT INTO users (username, email, password_hash, full_name, last_active)
         VALUES ($1, $2, $3, $4, CURRENT_DATE)
         RETURNING *`,
        [username, email, passwordHash, fullName]
      );

      const user = result.rows[0];

      await pool.query(
        `INSERT INTO user_settings (user_id)
         VALUES ($1)`,
        [user.user_id]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Account created successfully',
          user: {
            user_id: user.user_id,
            username: user.username,
            email: user.email,
            full_name: user.full_name,
            xp: 0,
            level: 1,
            streak_days: 0
          }
        })
      };
    }

    // Default response for unknown routes
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
