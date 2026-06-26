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
console.log('OpenAI key exists:', !!process.env.OPENAI_API_KEY);
console.log('OpenAI key prefix:', process.env.OPENAI_API_KEY?.slice(0, 12));
console.log('Brevo key exists:', !!process.env.BREVO_SMTP_KEY);
console.log('Database URL exists:', !!(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL));

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
    premium: user.premium || false,
    premium_until: user.premium_until || null,
    current_yct: user.current_yct || 1,
    current_hsk: user.current_hsk || 0,
    chinese_level: user.chinese_level || "YCT 1"
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

async function sendVerificationEmail({ to, username, token }) {
  const baseUrl = getFrontendBaseUrl();
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

async function sendPasswordResetEmail({ to, username, token }) {
  const baseUrl = getFrontendBaseUrl();
  const resetLink = `${baseUrl}/reset.html?token=${token}`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
      <h2>HanVerse Password Reset 🔒</h2>
      <p>Hi ${username || 'there'},</p>
      <p>We received a request to change your password. Click the link below to set up a new one:</p>
      <p>
        <a href="${resetLink}" style="display:inline-block;padding:12px 20px;background:#14B8A6;color:white;text-decoration:none;border-radius:8px;">
          Reset Password
        </a>
      </p>
      <p>This verification link is valid for 1 hour. If you did not make this request, you can safely ignore this email.</p>
    </div>
  `;

  await mailer.sendMail({
    from: EMAIL_FROM,
    to,
    subject: 'Reset your HanVerse password',
    html
  });
}

/* ==========================================
   HEALTH / DEBUG ROUTES 🩺
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
      '/',
      '/health',
      '/routes',
      '/signup',
      '/login',
      '/user/:userId',
      '/panda-chat',
      '/verify-email',
      '/forgot-password',
      '/reset-password',
      '/admin/verify-password',
      '/admin/overview',
      '/admin/email-all',
      '/admin/users/email/:id',
      '/admin/users/update/:id',
      '/admin/users/ban/:id',
      '/admin/users/delete/:id'
    ]
  });
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
      return res.status(401).json({ success: false, error: 'Invalid admin password password.' });
    }

    const adminToken = generateToken(32);

    return res.json({
      success: true,
      adminToken
    });

  } catch (error) {
    console.error('❌ Admin verification engine exception:', error);
    return res.status(500).json({ success: false, error: 'Admin validation failed.' });
  }
});

// Fetch Dashboard Overview Metrics
router.get('/admin/overview', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing security token context.' });
    }

    const usersQuery = await pool.query(`SELECT * FROM users ORDER BY created_at DESC`);

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
    console.error('❌ Loading administrative table payload exception:', error);
    return res.status(500).json({ success: false, error: 'Failed compiling system datasets.' });
  }
});

// Send Bulk Email to All Verified Users
router.post('/admin/email-all', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing security token context.' });
    }

    const { subject, message } = req.body || {};
    if (!subject || !message) {
      return res.status(400).json({ success: false, error: 'Subject and message body are required.' });
    }

    const usersResult = await pool.query(
      `SELECT email, username FROM users WHERE is_verified = true AND is_banned = false`
    );

    const users = usersResult.rows;
    if (users.length === 0) {
      return res.json({ success: true, message: 'No verified, active users found to email.' });
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

        await mailer.sendMail({
          from: EMAIL_FROM,
          to: user.email,
          subject: subject,
          html: html
        });
        sendCount++;
      } catch (mailErr) {
        console.warn(`⚠️ Failed sending bulk announcement to ${user.email}:`, mailErr.message);
      }
    }

    return res.json({
      success: true,
      message: `Successfully dispatched announcements to ${sendCount} active users.`
    });

  } catch (error) {
    console.error('❌ Bulk announcement failure:', error);
    return res.status(500).json({ success: false, error: 'Bulk email system failed.' });
  }
});

// Send Individual Direct Email
router.post('/admin/users/email/:id', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing security token context.' });
    }

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

    await mailer.sendMail({
      from: EMAIL_FROM,
      to: targetUser.email,
      subject: subject,
      html: html
    });

    return res.json({
      success: true,
      message: `Direct communication sent successfully to ${targetUser.email}`
    });

  } catch (error) {
    console.error('❌ Individual direct email pipeline failure:', error);
    return res.status(500).json({ success: false, error: 'Internal mail transport error.' });
  }
});

/* ==========================================================================
   ADMIN ACTIONS: EDIT, BAN, DELETE & UPGRADE (WITH PREMIUM PARAMS) ⚙️
========================================================================== */

// UPDATE USER DETAILS (With exact, transparent audit logs sent to user email)
router.post('/admin/users/update/:id', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing security token context.' });
    }

    const targetUserId = req.params.id;
    const { full_name, username, email, level, xp, is_admin, is_banned, premium, is_verified, password } = req.body || {};

    const oldUserRes = await pool.query(
      `SELECT email, username, is_admin, premium, xp, level FROM users WHERE user_id = $1`, 
      [targetUserId]
    );
    if (oldUserRes.rows.length === 0) return res.status(404).json({ success: false, error: 'User not found.' });
    const oldUser = oldUserRes.rows[0];

    // Execute structural database state mutation
    let query = `UPDATE users SET full_name=$1, username=$2, email=$3, level=$4, xp=$5, is_admin=$6, is_banned=$7, premium=$8, is_verified=$9`;
    let params = [full_name, username, email, level, xp, is_admin, is_banned, premium, is_verified, targetUserId];

    if (password && password.trim().length >= 6) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      query += `, password_hash=$11 WHERE user_id=$10`;
      params.push(hash);
    } else {
      query += ` WHERE user_id=$10`;
    }

    await pool.query(query, params);

    // Dynamic field difference audit tracing
    let changeLogs = [];

    if (oldUser.premium !== premium) {
      changeLogs.push(`<li><strong>Premium Membership Status:</strong> Modified from <em>${oldUser.premium ? 'Enabled ✨' : 'Disabled'}</em> to <strong>${premium ? 'Enabled ✨ (Welcome to HanVerse Premium!)' : 'Disabled (No longer Premium)'}</strong></li>`);
    }
    if (Number(oldUser.xp) !== Number(xp)) {
      changeLogs.push(`<li><strong>Experience Points (XP):</strong> Recalibrated from <em>${oldUser.xp} XP</em> to <strong>${xp} XP</strong></li>`);
    }
    if (Number(oldUser.level) !== Number(level)) {
      changeLogs.push(`<li><strong>Account Learning Level:</strong> Changed from <em>Level ${oldUser.level}</em> to <strong>Level ${level}</strong></li>`);
    }
    if (oldUser.is_admin !== is_admin) {
      changeLogs.push(`<li><strong>Administrative Privileges:</strong> Changed from <em>${oldUser.is_admin ? 'Admin' : 'Standard Learner'}</em> to <strong>${is_admin ? '👑 System Administrator' : 'Standard Learner'}</strong></li>`);
    }

    // Deliver explicit notification if tracking details altered
    if (changeLogs.length > 0) {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 24px;">
            <span style="font-size: 3rem;">🐼</span>
            <h2 style="color: #ff416c; margin: 10px 0 0 0;">HanVerse Account Modification Notice</h2>
          </div>
          <p>Hi ${username || 'Learner'},</p>
          <p>This message is to officially notify you that <strong>a system administrator has explicitly updated your account parameters</strong> on HanVerse. Please review the detailed profile changes below:</p>
          
          <ul style="background-color: #f9fafb; padding: 20px 20px 20px 35px; border-radius: 12px; border-left: 4px solid #ff416c; margin: 20px 0; line-height: 1.8;">
            ${changeLogs.join('')}
          </ul>
          
          <p>If you believe these tracking or status values were updated in error, please reach out to the support team immediately.</p>
          <p style="font-size: 0.85rem; color: #6b7280; text-align: center; margin-top: 40px; border-top: 1px solid #f3f4f6; padding-top: 20px;">
            Thank you for learning Mandarin with HanVerse!<br>
            🐼 Team HanVerse Support Ops
          </p>
        </div>
      `;

      await mailer.sendMail({
        from: EMAIL_FROM,
        to: email,
        subject: '⚙️ HanVerse Profile Updated by Administrator',
        html: emailHtml
      });
    }

    return res.json({ success: true, message: 'User parameters updated and highly specific audit notification dispatched.' });
  } catch (error) {
    console.error('❌ Update failure:', error);
    return res.status(500).json({ success: false, error: 'Failed to update user profile.' });
  }
});

// BAN / UNBAN USER
router.post('/admin/users/ban/:id', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing security token context.' });
    }

    const targetUserId = req.params.id;
    const { is_banned } = req.body;

    const userRes = await pool.query(`UPDATE users SET is_banned = $1 WHERE user_id = $2 RETURNING email, username`, [is_banned, targetUserId]);
    if (userRes.rows.length === 0) return res.status(404).json({ success: false, error: 'User missing.' });
    const user = userRes.rows[0];

    const subject = is_banned ? '🚨 Account Suspension Notice' : '🟢 Account Restored Notice';
    const messageHtml = is_banned 
      ? 'Your account has been explicitly suspended by an administrator due to policy or Terms of Service violations.' 
      : 'Good news! Your HanVerse account restrictions have been cleared by an administrator, and full structural access has been restored.';

    await mailer.sendMail({
      from: EMAIL_FROM,
      to: user.email,
      subject: subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">
              <div style="text-align:center;"><span style="font-size:3rem;">🐼</span><h2 style="color:#ff416c;">HanVerse Security Engine</h2></div>
              <p>Hi ${user.username},</p>
              <p>${messageHtml}</p>
              <p style="font-size:0.85rem;color:#6b7280;margin-top:30px;text-align:center;">HanVerse Moderation Desk</p>
            </div>`
    });

    return res.json({ success: true, message: `User account successfully ${is_banned ? 'banned' : 'unbanned'}.` });
  } catch (error) {
    console.error('❌ Ban adjustment failure:', error);
    return res.status(500).json({ success: false, error: 'Account modification broken.' });
  }
});

// HARD DELETE USER
router.post('/admin/users/delete/:id', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing security token context.' });
    }

    const targetUserId = req.params.id;

    const targetUserRes = await pool.query(`SELECT email, username FROM users WHERE user_id = $1`, [targetUserId]);
    if (targetUserRes.rows.length === 0) return res.status(404).json({ success: false, error: 'User database row not found.' });
    const user = targetUserRes.rows[0];

    try {
      await mailer.sendMail({
        from: EMAIL_FROM,
        to: user.email,
        subject: '❌ HanVerse Account Completely Removed',
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">
                <p>Hi ${user.username},</p>
                <p>This message confirms that an administrator has permanently deleted your HanVerse account profile and all its associated learning analytics metrics from our system files.</p>
                <p>We are sad to see you go! If you ever wish to resume learning Mandarin, you are welcome to sign up as a fresh user anytime.</p>
              </div>`
    });
    } catch(mailErr) {
      console.warn("⚠️ Departure warning email skipped:", mailErr.message);
    }

    await pool.query(`DELETE FROM user_progress WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM user_achievements WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM users WHERE user_id = $1`, [targetUserId]);

    return res.json({ success: true, message: 'Entity wiped completely from systems rows.' });
  } catch (error) {
    console.error('❌ Pipeline elimination failure:', error);
    return res.status(500).json({ success: false, error: 'Failed executing structural cascading deletion.' });
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
        error: 'Message required'
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key missing'
      });
    }

    const systemPrompt = `
You are Panda AI, a friendly Mandarin Chinese tutor for children aged 5–12 on HanVerse.

Rules:
- Use simple English
- Include pinyin where helpful
- Use emojis sometimes
- Be warm, encouraging, and child-friendly
- Keep answers short and clear
- Help with Mandarin words, phrases, pronunciation, characters, tones, and YCT-style learning
- If the child asks something unsafe or inappropriate, gently refuse and redirect back to learning Chinese
- If possible, make learning fun and interactive
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

    const reply = completion.choices?.[0]?.message?.content?.trim() || '🐼 Sorry, I could not answer that right now.';

    return res.json({
      success: true,
      reply
    });

  } catch (error) {
    console.error('❌ Panda OpenAI Error:', error);
    return res.status(500).json({
      success: false,
      error: error?.response?.data?.error?.message || error?.message || 'Panda AI failed'
    });
  }
});

/* ==========================================
   CORE USER AUTHORIZATION: LOGIN 🔑
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
      `SELECT * FROM users WHERE email = $1`,
      [email.trim().toLowerCase()]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    const valid = await bcrypt.compare(password, user.password_hash);
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

    if (!user.is_verified) {
      return res.status(403).json({
        success: false,
        error: "not_verified",
        message: "Please verify your email before logging in."
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
   USER PROFILE ACCESS 👤
========================================== */
router.get('/user/:userId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { userId } = req.params;

    const result = await pool.query(
      `SELECT * FROM users WHERE user_id = $1`,
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
   USER REGISTRATION: SIGNUP 🚀
========================================== */
router.post('/signup', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { username, full_name, email, password } = req.body || {};

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
      `SELECT user_id, email, username FROM users WHERE email = $1 OR username = $2`,
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
        username, full_name, email, password_hash, xp, level, streak_days, is_admin, is_banned, is_verified, premium
      )
      VALUES ($1, $2, $3, $4, 0, 1, 0, false, false, false, false)
      RETURNING *`,
      [cleanUsername, cleanFullName, cleanEmail, password_hash]
    );

    const newUser = insertResult.rows[0];

    try {
      await pool.query(
        `INSERT INTO email_verifications (user_id, token, created_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
         [newUser.user_id, verificationToken]
      );
    } catch (verificationInsertError) {
      console.warn("⚠️ Could not insert into email_verifications table:", verificationInsertError.message);
    }

    try {
      await sendVerificationEmail({
        to: cleanEmail,
        username: cleanUsername,
        token: verificationToken
      });
    } catch (mailError) {
      console.warn("⚠️ Verification email could not be sent:", mailError.message);
    }

    return res.status(201).json({
      success: true,
      message: "Signup successful",
      user: safeUser(newUser)
    });

  } catch (error) {
    console.error("❌ Signup error:", error);
    return res.status(500).json({
      success: false,
      error: "Signup failed"
    });
  }
});

/* ==========================================
   TOKEN AUDITING: VERIFY EMAIL 🧪
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

    const tokenResult = await pool.query(
      `SELECT user_id, token FROM email_verifications WHERE token = $1`,
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
      `UPDATE users SET is_verified = true WHERE user_id = $1`,
      [user_id]
    );

    await pool.query(
      `DELETE FROM email_verifications WHERE token = $1`,
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
   RESEND VERIFICATION PIPELINE 🔄
========================================== */
router.post('/resend-verification', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required.'
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const userResult = await pool.query(
      `SELECT user_id, username, is_verified FROM users WHERE email = $1`,
      [cleanEmail]
    );

    if (!userResult.rows.length) {
      return res.status(444).json({
        success: false,
        error: 'No account found with that email address.'
      });
    }

    const user = userResult.rows[0];

    if (user.is_verified) {
      return res.status(400).json({
        success: false,
        error: 'This account has already been verified. Please log in.'
      });
    }

    await pool.query(
      `DELETE FROM email_verifications WHERE user_id = $1`,
      [user.user_id]
    );

    const verificationToken = generateToken(24);

    await pool.query(
      `INSERT INTO email_verifications (user_id, token, created_at, expires_at)
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
      [user.user_id, verificationToken]
    );

    await sendVerificationEmail({
      to: cleanEmail,
      username: user.username,
      token: verificationToken
    });

    return res.json({
      success: true,
      message: 'Verification email sent successfully.'
    });

  } catch (error) {
    console.error('❌ Resend verification token error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process request. Please check server logs.'
    });
  }
});

/* ==========================================
   RECOVERY ENGINE: FORGOT PASSWORD 🔓
========================================== */
router.post('/forgot-password', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email address is required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const userResult = await pool.query(
      `SELECT user_id, username FROM users WHERE email = $1`,
      [cleanEmail]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, error: 'No account found with that email address.' });
    }

    const user = userResult.rows[0];
    const resetToken = generateToken(32);

    try {
      await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [user.user_id]);
    } catch(e) {}

    await pool.query(
      `INSERT INTO password_resets (user_id, token, created_at, expires_at)
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '1 hour')`,
      [user.user_id, resetToken]
    );

    await sendPasswordResetEmail({
      to: cleanEmail,
      username: user.username,
      token: resetToken
    });

    return res.json({
      success: true,
      message: 'Password reset link has been dispatched to your email address.'
    });

  } catch (error) {
    console.error('❌ Forgot password action failure:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to process recovery lookup' });
  }
});

/* ==========================================
   RECOVERY INTEGRATION: RESET PASSWORD 📑
========================================== */
router.post('/reset-password', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, error: 'Token and new password are required.' });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, error: 'The new password must contain at least 8 characters.' });
    }

    const tokenResult = await pool.query(
      `SELECT user_id FROM password_resets WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );

    if (!tokenResult.rows.length) {
      return res.status(400).json({ success: false, error: 'Invalid or expired password reset token.' });
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
    console.error('❌ Reset password endpoint handling exception:', error);
    return res.status(500).json({ success: false, error: 'Password update operation failed.' });
  }
});

/* ==========================================
   ROOT DESK INDEX ROUTE 🏡
========================================== */
router.get('/', (req, res) => {
  return res.json({
    ok: true,
    message: 'HanVerse API root',
    routes: [
      '/',
      '/health',
      '/routes',
      '/signup',
      '/login',
      '/user/:userId',
      '/panda-chat',
      '/verify-email',
      '/forgot-password',
      '/reset-password'
    ]
  });
});

/* ==========================================
   NETLIFY MOUNT & EXPORT ENGINE 🚀
========================================== */
app.use('/.netlify/functions/server', router);
app.use('/api', router);

const handler = serverless(app);
export { handler };