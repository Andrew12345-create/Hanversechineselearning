import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import dotenv from 'dotenv';
import serverless from 'serverless-http';


dotenv.config();

const { Pool } = pkg;

/* ==========================================
   APP / ROUTER
========================================== */

const app = express();
const router = express.Router();

app.use(cors());

app.use(express.json({
  limit: '10mb'
}));

app.use(express.urlencoded({
  extended: true
}));

/* ==========================================
   ENV / STARTUP LOGS
========================================== */

console.log('Gemini key exists:', !!process.env.GEMINI_API_KEY);
console.log('Database URL exists:', !!(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL));
console.log('Brevo key exists:', !!process.env.BREVO_SMTP_KEY);

/* ==========================================
   DATABASE
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
   GEMINI AI
========================================== */


/* ==========================================
   EMAIL CONFIG
========================================== */

const EMAIL_FROM =
  process.env.EMAIL_FROM ||
  '"HanVerse" <support@hanverse.net>';

const mailer = nodemailer.createTransport({
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

/* ==========================================
   HELPERS
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
    username: user.username,
    full_name: user.full_name,
    email: user.email,
    xp: user.xp || 0,
    level: user.level || 1,
    streak_days: user.streak_days || 0,
    profile_picture: user.profile_picture || null,
    is_admin: user.is_admin || false,
    is_banned: user.is_banned || false,
    banned_reason: user.banned_reason || null,
    is_verified: user.is_verified || false,
    premium: user.is_premium || false,
    chinese_level: user.chinese_level || 'YCT 1'
  };
}

function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

async function sendVerificationEmail({ to, username, token }) {
  const baseUrl =
    process.env.PUBLIC_SITE_URL ||
    process.env.URL ||
    'http://localhost:8888';

  const verifyLink = `${baseUrl}/verify.html?token=${token}`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
      <h2>Welcome to HanVerse 🐼</h2>
      <p>Hi ${username || 'there'},</p>
      <p>Thanks for signing up. Please verify your email to activate your account.</p>
      <p>
        <a href="${verifyLink}" style="display:inline-block;padding:12px 20px;background:#2563EB;color:white;text-decoration:none;border-radius:8px;">
          Verify Email
        </a>
      </p>
      <p>If the button doesn’t work, copy and paste this link into your browser:</p>
      <p>${verifyLink}</p>
    </div>
  `;

  await mailer.sendMail({
    from: EMAIL_FROM,
    to,
    subject: 'Verify your HanVerse account',
    html
  });
}

/* ==========================================
   HEALTH / DEBUG ROUTES
========================================== */

router.get('/health', (req, res) => {
  return res.json({
    ok: true,
    app: 'HanVerse',
    status: 'Running'
  });
});

router.get('/routes', (req, res) => {
  return res.json({
    routes: [
      '/health',
      '/routes',
      '/signup',
      '/login',
      '/user/:userId',
      '/panda-chat',
      '/verify-email'
    ]
  });
});

/* ==========================================
   PANDA AI
========================================== */

router.post('/panda-chat', async (req, res) => {
  try {
    const { message } = req.body || {};

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message required'
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Gemini API key missing'
      });
    }

    const prompt = `
You are Panda AI.

You help children aged 5-12 learn Mandarin Chinese.

Rules:
- Use simple English
- Include pinyin
- Use emojis
- Be encouraging
- Follow YCT curriculum
- Keep answers short and child-friendly
- If asked something unsafe or inappropriate for children, gently refuse and redirect to Mandarin learning

Student question:
${message}
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 seconds

    let geminiResponse;

    try {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt }
                ]
              }
            ]
          })
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await geminiResponse.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error('❌ Gemini non-JSON response:', rawText);
      return res.status(500).json({
        success: false,
        error: 'Gemini returned a non-JSON response'
      });
    }

    if (!geminiResponse.ok) {
      console.error('❌ Gemini API error:', data);

      return res.status(500).json({
        success: false,
        error: data?.error?.message || 'Gemini request failed'
      });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.map(part => part.text).join(' ').trim() ||
      '🐼 Sorry, I could not answer that right now.';

    return res.json({
      success: true,
      reply
    });

  } catch (error) {
    console.error('❌ Panda Error:', error);

    if (error.name === 'AbortError') {
      return res.status(504).json({
        success: false,
        error: 'Panda AI timed out while waiting for Gemini'
      });
    }

    return res.status(500).json({
      success: false,
      error: error?.message || 'Panda AI failed'
    });
  }
});

/* ==========================================
   LOGIN
========================================== */

router.post('/login', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password required'
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM users
       WHERE email = $1`,
      [email.trim().toLowerCase()]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    const valid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    if (user.is_banned) {
      return res.status(403).json({
        success: false,
        error: 'banned',
        reason: user.banned_reason || 'Account banned'
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
      error: 'Login failed'
    });
  }
});

/* ==========================================
   USER PROFILE
========================================== */

router.get('/user/:userId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { userId } = req.params;

    const result = await pool.query(
      `SELECT *
       FROM users
       WHERE user_id = $1`,
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    return res.json({
      success: true,
      user: safeUser(result.rows[0])
    });

  } catch (error) {
    console.error('❌ Profile error:', error);

    return res.status(500).json({
      success: false,
      error: 'Profile error'
    });
  }
});
/* ==========================================
   SIGNUP
========================================== */

router.post('/signup', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const {
      username,
      full_name,
      email,
      password
    } = req.body || {};

    if (!username || !full_name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username, full name, email and password are required'
      });
    }

    const cleanUsername = String(username).trim();
    const cleanFullName = String(full_name).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPassword = String(password);

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    const existing = await pool.query(
      `SELECT user_id, email, username
       FROM users
       WHERE email = $1 OR username = $2`,
      [cleanEmail, cleanUsername]
    );

    if (existing.rows.length) {
      const conflict = existing.rows[0];

      if (conflict.email === cleanEmail) {
        return res.status(409).json({
          success: false,
          error: 'An account with that email already exists'
        });
      }

      if (conflict.username === cleanUsername) {
        return res.status(409).json({
          success: false,
          error: 'That username is already taken'
        });
      }
    }

    const password_hash = await bcrypt.hash(cleanPassword, 10);
    const verificationToken = generateToken(24);

    const insertResult = await pool.query(
      `INSERT INTO users (
        username,
        full_name,
        email,
        password_hash,
        xp,
        level,
        streak_days,
        is_admin,
        is_banned,
        is_verified,
        is_premium
      )
      VALUES ($1, $2, $3, $4, 0, 1, 0, false, false, false, false)
      RETURNING *`,
      [
        cleanUsername,
        cleanFullName,
        cleanEmail,
        password_hash
      ]
    );

    const newUser = insertResult.rows[0];

    /* Save verification token if table exists */
    try {
      await pool.query(
        `INSERT INTO email_verifications (
          user_id,
          token,
          created_at
        )
        VALUES ($1, $2, NOW())`,
        [newUser.user_id, verificationToken]
      );
    } catch (verificationInsertError) {
      console.warn(
        '⚠️ Could not insert into email_verifications table:',
        verificationInsertError.message
      );
    }

    /* Try to send verification email, but don't fail signup if mail fails */
    try {
      await sendVerificationEmail({
        to: cleanEmail,
        username: cleanUsername,
        token: verificationToken
      });
    } catch (mailError) {
      console.error('❌ Verification email failed:', mailError.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Signup successful',
      user: safeUser(newUser)
    });

  } catch (error) {
    console.error('❌ Signup error:', error);

    return res.status(500).json({
      success: false,
      error: 'Signup failed'
    });
  }
});

/* ==========================================
   VERIFY EMAIL
========================================== */

router.post('/verify-email', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { token } = req.body || {};

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Verification token required'
      });
    }

    /* Find verification token */
    const tokenResult = await pool.query(
      `SELECT user_id, token
       FROM email_verifications
       WHERE token = $1`,
      [token]
    );

    if (!tokenResult.rows.length) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification token'
      });
    }

    const { user_id } = tokenResult.rows[0];

    await pool.query(
      `UPDATE users
       SET is_verified = true
       WHERE user_id = $1`,
      [user_id]
    );

    await pool.query(
      `DELETE FROM email_verifications
       WHERE token = $1`,
      [token]
    );

    return res.json({
      success: true,
      message: 'Email verified successfully'
    });

  } catch (error) {
    console.error('❌ Verify email error:', error);

    return res.status(500).json({
      success: false,
      error: 'Email verification failed'
    });
  }
});

/* ==========================================
   OPTIONAL ROOT DEBUG
   Useful if you ever hit the function directly
========================================== */

router.get('/', (req, res) => {
  return res.json({
    ok: true,
    message: 'HanVerse API root',
    routes: [
      '/health',
      '/routes',
      '/signup',
      '/login',
      '/user/:userId',
      '/panda-chat',
      '/verify-email'
    ]
  });
});

/* ==========================================
   NETLIFY MOUNT
========================================== */

app.use('/.netlify/functions/server', router);

/* ==========================================
   NETLIFY HANDLER
========================================== */

export const handler = serverless(app);