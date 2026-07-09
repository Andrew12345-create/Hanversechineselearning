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
// ==========================================
// EMAIL VERIFICATION SYSTEM 📧
// ==========================================

// ==========================================
// SEND VERIFICATION EMAIL - FIXED
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

        console.log(`📤 Send verification request for user: ${userId}`);

        // Get user details
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
        console.log(`👤 User found: ${user.email}`);

        // Check if already verified
        if (user.is_verified) {
            return res.status(400).json({
                success: false,
                error: 'Email is already verified.'
            });
        }

        // Generate verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        console.log(`🔑 Generated token: ${verificationToken.substring(0, 10)}...`);

        // Check if email_verifications table exists, create if not
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

        // Store or update token
        const insertResult = await pool.query(
            `INSERT INTO email_verifications (user_id, email, token, expires_at, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (user_id) DO UPDATE 
             SET token = $3, email = $2, expires_at = $4, created_at = NOW()
             RETURNING *`,
            [userId, user.email, verificationToken, expiresAt]
        );

        console.log(`✅ Token stored for user ${userId}`);

        // Build verification link
        const baseUrl = getFrontendBaseUrl();
       const verifyLink = `${baseUrl}/verify-email.html?token=${verificationToken}&email=${encodeURIComponent(user.email)}`;

        console.log(`🔗 Verification link: ${verifyLink}`);

        // Check if mailer is configured
        if (!mailer) {
            console.error('❌ Mailer not configured!');
            return res.status(500).json({
                success: false,
                error: 'Email service is not configured. Please contact support.'
            });
        }

        // Send email
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: 'Poppins', Arial, sans-serif; background: #0D0D1A; color: #E8E8F0; margin: 0; padding: 0; }
                    .container { max-width: 600px; margin: 40px auto; background: #151529; border-radius: 24px; padding: 40px; border: 1px solid rgba(255,255,255,0.08); }
                    .logo { text-align: center; font-size: 32px; margin-bottom: 20px; }
                    .title { font-size: 28px; font-weight: 700; color: #FFFFFF; text-align: center; margin-bottom: 16px; }
                    .subtitle { color: #8E8EA8; text-align: center; margin-bottom: 30px; line-height: 1.6; }
                    .button { display: block; width: fit-content; margin: 30px auto; padding: 16px 40px; background: linear-gradient(135deg, #ff416c, #ff4b2b); color: white; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 16px; transition: transform 0.2s; box-shadow: 0 4px 16px rgba(255, 65, 108, 0.3); }
                    .button:hover { transform: translateY(-2px); }
                    .footer { text-align: center; color: #8E8EA8; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.08); }
                    .footer a { color: #4EA8DE; text-decoration: none; }
                    .expiry { color: #8E8EA8; font-size: 14px; text-align: center; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="logo">🐼 HanVerse</div>
                    <div class="title">Verify Your Email Address</div>
                    <div class="subtitle">
                        Hi <strong>${user.full_name || user.username || 'Parent'}</strong>!<br>
                        Welcome to HanVerse! Please verify your email address to get full access to the Parent Hub.
                    </div>
                    <a href="${verifyLink}" class="button">✅ Verify Email</a>
                    <div class="expiry">⏰ This link expires in <strong>24 hours</strong></div>
                    <div class="footer">
                        <p>If you didn't create a HanVerse account, you can ignore this email.</p>
                        <p>Need help? <a href="mailto:support@hanverse.com">support@hanverse.com</a></p>
                    </div>
                </div>
            </body>
            </html>
        `;

        const mailResult = await mailer.sendMail({
            from: EMAIL_FROM,
            to: user.email,
            subject: 'Verify Your HanVerse Email Address',
            html: html
        });

        console.log(`✅ Verification email sent to ${user.email}`);

        return res.json({
            success: true,
            message: 'Verification email sent successfully.',
            email: user.email
        });

    } catch (error) {
        console.error('❌ Send verification error:', error);
        console.error('❌ Error stack:', error.stack);
        return res.status(500).json({
            success: false,
            error: 'Failed to send verification email. Please try again.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
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

    // Get user details
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

    // Delete old token
    await pool.query(
      `DELETE FROM email_verifications WHERE user_id = $1`,
      [userId]
    );

    // Generate new token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO email_verifications (user_id, email, token, expires_at, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [userId, user.email, verificationToken, expiresAt]
    );

    // Build verification link
    const baseUrl = getFrontendBaseUrl();
    const verifyLink = `${baseUrl}/verify.html?token=${verificationToken}&email=${encodeURIComponent(user.email)}`;

    // Send email (same HTML as above)
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Poppins', Arial, sans-serif; background: #0D0D1A; color: #E8E8F0; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 40px auto; background: #151529; border-radius: 24px; padding: 40px; border: 1px solid rgba(255,255,255,0.08); }
          .logo { text-align: center; font-size: 32px; margin-bottom: 20px; }
          .title { font-size: 28px; font-weight: 700; color: #FFFFFF; text-align: center; margin-bottom: 16px; }
          .subtitle { color: #8E8EA8; text-align: center; margin-bottom: 30px; line-height: 1.6; }
          .button { display: block; width: fit-content; margin: 30px auto; padding: 16px 40px; background: linear-gradient(135deg, #ff416c, #ff4b2b); color: white; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 16px rgba(255, 65, 108, 0.3); }
          .expiry { color: #8E8EA8; font-size: 14px; text-align: center; margin-top: 20px; }
          .footer { text-align: center; color: #8E8EA8; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.08); }
          .footer a { color: #4EA8DE; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">🐼 HanVerse</div>
          <div class="title">Verify Your Email Address</div>
          <div class="subtitle">
            Hi <strong>${user.full_name || user.username || 'Parent'}</strong>!<br>
            We've resent your verification email. Please click the link below to verify your account.
          </div>
          <a href="${verifyLink}" class="button">✅ Verify Email</a>
          <div class="expiry">⏰ This link expires in <strong>24 hours</strong></div>
          <div class="footer">
            <p>Need help? <a href="mailto:support@hanverse.com">support@hanverse.com</a></p>
          </div>
        </div>
      </body>
      </html>
    `;

    if (mailer) {
      await mailer.sendMail({
        from: EMAIL_FROM,
        to: user.email,
        subject: 'Resend: Verify Your HanVerse Email',
        html: html
      });
      console.log(`✅ Verification email resent to ${user.email}`);
    } else {
      console.warn('⚠️ Mailer not available, skipping email send');
    }

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
// CHECK VERIFICATION STATUS - FIXED
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
// VERIFY EMAIL (Public endpoint for link click)
// ==========================================
router.get('/verify-email', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { token, email } = req.query;

    if (!token || !email) {
      return res.status(400).json({
        success: false,
        error: 'Missing verification parameters.'
      });
    }

    // Find the verification record
    const tokenResult = await pool.query(
      `SELECT user_id, email, expires_at 
       FROM email_verifications 
       WHERE token = $1 AND email = $2`,
      [token, email]
    );

    if (!tokenResult.rows.length) {
      return res.redirect(`${getFrontendBaseUrl()}/verify-success?verified=false&error=Invalid+verification+link`);
    }

    const record = tokenResult.rows[0];

    // Check if token expired
    if (new Date(record.expires_at) < new Date()) {
      return res.redirect(`${getFrontendBaseUrl()}/verify-success?verified=false&error=Link+has+expired.+Please+request+a+new+one.`);
    }

    // Update user as verified
    await pool.query(
      `UPDATE users 
       SET is_verified = true, 
           verified_at = NOW(),
           email_confirmed = true
       WHERE user_id = $1`,
      [record.user_id]
    );

    // Delete used token
    await pool.query(
      `DELETE FROM email_verifications WHERE token = $1`,
      [token]
    );

    console.log(`✅ Email verified for user ${record.user_id}`);

    return res.redirect(`${getFrontendBaseUrl()}/verify-success?verified=true`);

  } catch (error) {
    console.error('❌ Verify email error:', error);
    return res.redirect(`${getFrontendBaseUrl()}/verify-success?verified=false&error=System+error.+Please+try+again.`);
  }
});
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
    chinese_level: user.chinese_level || "YCT 1",
    role: user.role || 'student'
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
      <p>If the button doesn't work, copy and paste this link into your browser:</p>
      <p>${verifyLink}</p>
    </div>
  `;

  if (mailer) {
    await mailer.sendMail({
      from: EMAIL_FROM,
      to,
      subject: 'Verify your HanVerse account',
      html
    });
  } else {
    console.warn('⚠️ Mailer not available, skipping email send');
  }
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

  if (mailer) {
    await mailer.sendMail({
      from: EMAIL_FROM,
      to,
      subject: 'Reset your HanVerse password',
      html
    });
  } else {
    console.warn('⚠️ Mailer not available, skipping email send');
  }
}

// ==========================================
// MIDDLEWARE: Admin Auth Check
// ==========================================
// Add to server.js - ADMIN ONLY endpoint
router.post('/admin/toggle-verification/:userId', verifyAdminToken, async (req, res) => {
    try {
        if (!ensurePool(res)) return;
        
        const { userId } = req.params;
        const { verified } = req.body; // true or false
        
        // Get current user
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
   HEALTH / DEBUG ROUTES 🩺
========================================== */
router.get('/health', (req, res) => {
  return res.json({
    ok: true,
    app: 'HanVerse',
    status: 'Running',
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
      { method: 'POST', path: '/panda-chat' },
      { method: 'POST', path: '/verify-email' },
      { method: 'POST', path: '/resend-verification' },
      { method: 'POST', path: '/forgot-password' },
      { method: 'POST', path: '/reset-password' },
      { method: 'POST', path: '/admin/verify-password' },
      { method: 'GET', path: '/admin/overview' },
      { method: 'GET', path: '/admin/pending-parents' },
      { method: 'POST', path: '/admin/verify-parent/:id' },
      { method: 'POST', path: '/admin/email-all' },
      { method: 'POST', path: '/admin/users/email/:id' },
      { method: 'POST', path: '/admin/users/update/:id' },
      { method: 'POST', path: '/admin/users/ban/:id' },
      { method: 'DELETE', path: '/admin/users/delete/:id' },
      { method: 'GET', path: '/admin/parents' },
      { method: 'GET', path: '/admin/parents/pending' },
      { method: 'POST', path: '/admin/parents/verify/:parentId' },
      { method: 'POST', path: '/admin/parents/deny/:parentId' },
      { method: 'GET', path: '/parents/dashboard/:parentId' },
      { method: 'POST', path: '/parents/create' },
      { method: 'PUT', path: '/parents/:parentId' },
      { method: 'DELETE', path: '/parents/:parentId' }
    ]
  });
});

// ==========================================
// ⭐ USER PROFILE ROUTE (ONLY ONE - FIXED) ⭐
// ==========================================
router.get('/user/:userId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { userId } = req.params;

    const result = await pool.query(
      `SELECT user_id, username, full_name, email, xp, level, streak_days, 
              profile_picture, is_admin, is_banned, banned_reason, is_verified, 
              premium, premium_until, current_yct, current_hsk, chinese_level, role
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
    
    // Return with BOTH id and user_id for compatibility
    return res.json({
      success: true,
      user: {
        user_id: user.user_id,
        id: user.user_id,  // <-- IMPORTANT: Add this for frontend compatibility
        username: user.username,
        full_name: user.full_name,
        fullName: user.full_name,  // <-- Add this too
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
        is_premium: user.premium || false,  // <-- Add this
        premium_until: user.premium_until || null,
        current_yct: user.current_yct || 1,
        current_hsk: user.current_hsk || 0,
        chinese_level: user.chinese_level || "YCT 1",
        role: user.role || 'student'
      }
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
// PARENT PASSWORD VERIFICATION 🔐
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

    // Get the parent user from database
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

    // Check if parent is verified
    if (!parent.is_verified) {
      return res.status(403).json({
        success: false,
        error: 'Parent account is not verified.'
      });
    }

    // Check if parent is banned
    if (parent.is_banned) {
      return res.status(403).json({
        success: false,
        error: 'Parent account is banned.'
      });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, parent.password_hash);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid password. Please try again.'
      });
    }

    // Password is correct
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

// ==========================================
// GET SINGLE CHILD BY ID (for child profile)
// ==========================================

router.get('/parents/child/:childId', async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { childId } = req.params;
    const parentId = req.query.parentId || req.headers['x-parent-id'];

    console.log('🔍=== FETCHING CHILD PROFILE ===');
    console.log('📥 Child ID:', childId);
    console.log('📥 Parent ID (from query):', parentId);

    if (!parentId) {
      console.log('❌ No parent ID provided');
      return res.status(400).json({
        success: false,
        error: 'Parent ID is required.'
      });
    }

    // 1. First, get the child data
    console.log('📊 Querying for child...');
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

    console.log('📊 Child query result:', childResult.rows.length > 0 ? 'FOUND' : 'NOT FOUND');

    if (!childResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Child not found.'
      });
    }

    const child = childResult.rows[0];
    console.log('📊 Child data:', {
      child_id: child.child_id,
      full_name: child.full_name,
      parent_id: child.parent_id,
      user_id: child.user_id
    });

    // 2. Verify parent exists (parent is a USER with role='parent')
    console.log('🔍 Verifying parent user...');
    const parentCheck = await pool.query(
      `SELECT user_id, is_verified, is_banned, role FROM users WHERE user_id = $1`,
      [parentId]
    );

    console.log('📊 Parent check:', parentCheck.rows.length > 0 ? 'FOUND' : 'NOT FOUND');
    if (parentCheck.rows.length > 0) {
      console.log('📊 Parent role:', parentCheck.rows[0].role);
    }

    if (!parentCheck.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Parent user not found.'
      });
    }

    const parentUser = parentCheck.rows[0];

    if (parentUser.role !== 'parent') {
      console.log('❌ User is not a parent. Role:', parentUser.role);
      return res.status(403).json({
        success: false,
        error: 'User is not a parent.'
      });
    }

    if (!parentUser.is_verified) {
      return res.status(403).json({
        success: false,
        error: 'Parent account is not verified.'
      });
    }

    if (parentUser.is_banned) {
      return res.status(403).json({
        success: false,
        error: 'Parent account is banned.'
      });
    }

    // 3. Verify ownership - child's parent_id must match parent's parent_id
    console.log('🔍 Verifying ownership...');
    console.log('  - Child parent_id:', child.parent_id);
    console.log('  - Parent user_id:', parentId);

    // First, get the parent's parent_id from the parents table
    const parentRecordCheck = await pool.query(
      `SELECT parent_id FROM parents WHERE user_id = $1`,
      [parentId]
    );

    console.log('📊 Parent record check:', parentRecordCheck.rows.length > 0 ? 'FOUND' : 'NOT FOUND');
    
    if (parentRecordCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Parent record not found. Please contact support.'
      });
    }

    const parentRecordId = parentRecordCheck.rows[0].parent_id;
    console.log('  - Parent record ID:', parentRecordId);
    console.log('  - Child parent_id:', child.parent_id);

    // Check if they match
    if (child.parent_id !== parentRecordId) {
      console.log('❌ Ownership mismatch!');
      console.log('  - Child belongs to parent_id:', child.parent_id);
      console.log('  - Parent user owns parent_id:', parentRecordId);
      
      return res.status(403).json({
        success: false,
        error: 'Access denied. This child does not belong to you.',
        debug: {
          childParentId: child.parent_id,
          parentRecordId: parentRecordId,
          parentUserId: parentId
        }
      });
    }

    console.log('✅ Ownership verified!');

    // 4. Return the child data
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
    console.error('❌ ERROR in /parents/child/:childId:', error);
    console.error('❌ Error stack:', error.stack);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch child profile.',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});
// ==========================================
// UPDATE CHILD (for editable fields)
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

    // Verify parent exists and is verified
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

    // Verify child belongs to parent
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

    // Build update query dynamically
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

    // Also update the user table if email changed
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
      error: 'Failed to update child.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==========================================
// GET CHILD ACTIVITY
// ==========================================

router.get('/parents/child/:childId/activity', async (req, res) => {
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

    // Verify child belongs to parent
    const childCheck = await pool.query(
      `SELECT child_id FROM children WHERE child_id = $1 AND parent_id = $2`,
      [childId, parentId]
    );

    if (!childCheck.rows.length) {
      return res.status(403).json({
        success: false,
        error: 'Access denied.'
      });
    }

    // Fetch activities from child_activities table
    const activitiesResult = await pool.query(`
      SELECT 
        activity_id,
        type,
        message,
        created_at
      FROM child_activities
      WHERE child_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [childId]);

    return res.json({
      success: true,
      activities: activitiesResult.rows || []
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
// UPDATE CHILD (for editable fields)
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

    // Verify parent exists and is verified
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

    // Verify child belongs to parent
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

    // Build update query dynamically
    let updates = [];
    let values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`full_name = $${paramIndex}`);
      values.push(name);
      paramIndex++;
    }

    if (age !== undefined) {
      updates.push(`age = $${paramIndex}`);
      values.push(age);
      paramIndex++;
    }

    if (level !== undefined) {
      updates.push(`level = $${paramIndex}`);
      values.push(level);
      paramIndex++;
    }

    if (email !== undefined) {
      updates.push(`email = $${paramIndex}`);
      values.push(email);
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

    // Also update the user table if needed (for email, etc.)
    if (email !== undefined) {
      await pool.query(
        `UPDATE users SET email = $1 WHERE user_id = (SELECT user_id FROM children WHERE child_id = $2)`,
        [email, childId]
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
      error: 'Failed to update child.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
// ==========================================
// CHILDREN ENDPOINTS 👶
// ==========================================

// GET: Fetch all children for a parent
router.get('/parents/children/:parentId', async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { parentId } = req.params;
        console.log('📥 Fetching children for parent:', parentId);

        // Verify parent exists
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

        // Fetch children from the children table
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
            WHERE parent_id = $1
            AND is_active = true
            ORDER BY full_name
        `, [parentRecordId]);

        // Map children data
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
            is_verified: true, // Children are auto-verified
            is_banned: child.is_banned || false,
            is_active: child.is_active || true,
            username: child.username || '',
            email: child.email || '',
            created_at: child.created_at,
            last_active: child.last_active,
            last_lesson_at: child.last_lesson_at
        }));

        console.log(`✅ Found ${children.length} children for parent ${parentId}`);

        return res.json({
            success: true,
            children: children
        });

    } catch (error) {
        console.error('❌ Error fetching children:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch children data.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// POST: Add a new child (with username, email, password)
router.post('/parents/children', async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { parentId, full_name, age, level, username, email, password } = req.body || {};

        console.log('📤 Adding child request:', { parentId, full_name, age, level, username, email });

        // --- VALIDATION ---
        if (!parentId) {
            return res.status(400).json({
                success: false,
                error: 'Parent ID is required.'
            });
        }

        if (!full_name || full_name.trim().length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Child name must be at least 2 characters.'
            });
        }

        if (!age || age < 4 || age > 18) {
            return res.status(400).json({
                success: false,
                error: 'Age must be between 4 and 18.'
            });
        }

        if (!username || username.trim().length < 3) {
            return res.status(400).json({
                success: false,
                error: 'Username must be at least 3 characters.'
            });
        }

        // Username validation
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({
                success: false,
                error: 'Username can only contain letters, numbers, and underscores.'
            });
        }

        if (!password || password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 6 characters.'
            });
        }

        const cleanUsername = username.trim().toLowerCase();
        const cleanEmail = email ? email.trim().toLowerCase() : null;

        // --- CHECK IF USERNAME OR EMAIL EXISTS ---
        const existingCheck = await pool.query(`
            SELECT username, email FROM users 
            WHERE username = $1 OR (email = $2 AND $2 IS NOT NULL)
        `, [cleanUsername, cleanEmail]);

        if (existingCheck.rows.length > 0) {
            const conflict = existingCheck.rows[0];
            if (conflict.username === cleanUsername) {
                return res.status(409).json({
                    success: false,
                    error: 'Username is already taken. Please choose a different one.'
                });
            }
            if (conflict.email === cleanEmail) {
                return res.status(409).json({
                    success: false,
                    error: 'Email is already registered. Please use a different email.'
                });
            }
        }

        // --- FIND THE PARENT ---
        let parentRecord = null;
        
        const parentQuery = await pool.query(`
            SELECT p.*, u.is_verified, u.is_banned, u.email as user_email
            FROM parents p
            JOIN users u ON p.user_id = u.user_id
            WHERE p.user_id = $1 OR p.parent_id = $1
        `, [parentId]);

        if (parentQuery.rows.length > 0) {
            parentRecord = parentQuery.rows[0];
            console.log('✅ Found parent:', parentRecord);
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
                console.log('✅ Created parent record:', parentRecord);
            } else {
                return res.status(404).json({
                    success: false,
                    error: 'Parent not found. Please make sure you are verified as a parent.'
                });
            }
        }

        // --- CHECK IF PARENT IS VERIFIED ---
        if (!parentRecord.is_verified) {
            return res.status(403).json({
                success: false,
                error: 'Parent account not verified. Please wait for admin verification.'
            });
        }

        if (parentRecord.is_banned) {
            return res.status(403).json({
                success: false,
                error: 'Parent account is banned.'
            });
        }

        // --- CREATE USER ACCOUNT FOR CHILD ---
        const cleanName = full_name.trim();
        const password_hash = await bcrypt.hash(password, 10);
        
        // Generate email if not provided
        const finalEmail = cleanEmail || `${cleanUsername}@hanverse.child`;

        const userResult = await pool.query(`
            INSERT INTO users (
                username,
                full_name,
                email,
                password_hash,
                role,
                is_verified,
                is_banned,
                premium,
                xp,
                level,
                streak_days,
                created_at,
                updated_at
            ) VALUES ($1, $2, $3, $4, 'student', true, false, false, 0, 1, 0, NOW(), NOW())
            RETURNING user_id
        `, [cleanUsername, cleanName, finalEmail, password_hash]);

        const childUserId = userResult.rows[0].user_id;
        console.log('✅ Child user created:', childUserId);

        // --- INSERT INTO CHILDREN TABLE ---
        const childResult = await pool.query(`
            INSERT INTO children (
                parent_id,
                user_id,
                full_name,
                age,
                level,
                username,
                email,
                password_hash,
                created_at,
                updated_at
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
        console.log('✅ Child record created:', newChild);

        // --- UPDATE PARENT'S CHILDREN COUNT ---
        try {
            await pool.query(`
                UPDATE parents 
                SET children_count = children_count + 1,
                    updated_at = NOW()
                WHERE parent_id = $1
            `, [parentRecord.parent_id]);
        } catch (countError) {
            console.warn('⚠️ Could not update children count:', countError.message);
        }

        // --- LOG ACTIVITY ---
        try {
            await pool.query(`
                INSERT INTO child_activities (child_id, type, message, created_at)
                VALUES ($1, 'child_added', $2, NOW())
            `, [newChild.child_id, `Child ${cleanName} (${age} years old) was added to the account`]);
            console.log('✅ Activity logged');
        } catch (logError) {
            console.warn('⚠️ Could not log activity:', logError.message);
        }

        // --- SEND EMAIL TO PARENT ---
        try {
            if (mailer) {
                const parentEmail = parentRecord.user_email || parentRecord.email;
                
                if (parentEmail) {
                    const html = `
                        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">
                            <div style="text-align:center;margin-bottom:20px;">
                                <span style="font-size:3rem;">👶</span>
                                <h2 style="color:#ff416c;margin:10px 0 0 0;">Child Account Created!</h2>
                            </div>
                            <p>Hi Parent,</p>
                            <p><strong>${cleanName}</strong> has been successfully added to your HanVerse account!</p>
                            <div style="background-color:#f9fafb;padding:15px;border-radius:8px;margin:20px 0;">
                                <p style="margin:4px 0;"><strong>Name:</strong> ${cleanName}</p>
                                <p style="margin:4px 0;"><strong>Age:</strong> ${age}</p>
                                <p style="margin:4px 0;"><strong>Level:</strong> ${level || 'YCT 1'}</p>
                                <p style="margin:4px 0;"><strong>Username:</strong> ${cleanUsername}</p>
                            </div>
                            <p>Your child can now log in and start learning Mandarin with Panda AI! 🐼</p>
                            <p style="font-size:0.85rem;color:#6b7280;text-align:center;margin-top:30px;">
                                🐼 Happy Learning!
                            </p>
                        </div>
                    `;

                    await mailer.sendMail({
                        from: EMAIL_FROM,
                        to: parentEmail,
                        subject: `👶 ${cleanName} Added to HanVerse!`,
                        html
                    });
                    console.log('✅ Confirmation email sent to parent');
                }
            }
        } catch (mailErr) {
            console.warn('⚠️ Child addition email failed:', mailErr.message);
        }

        // --- RETURN SUCCESS ---
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
        console.error('❌ Stack trace:', error.stack);
        return res.status(500).json({
            success: false,
            error: 'Failed to add child. Please try again.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET: Fetch child activity feed
router.get('/parents/activity/:parentId', async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { parentId } = req.params;

        // Verify parent exists
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

        // Fetch activities from child_activities table
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

        const activities = activitiesResult.rows.map(activity => ({
            activity_id: activity.activity_id,
            type: activity.type || 'info',
            message: activity.message || 'Activity occurred',
            created_at: activity.created_at,
            child_name: activity.child_name || 'Child',
            child_id: activity.child_id
        }));

        return res.json({
            success: true,
            activities: activities
        });

    } catch (error) {
        console.error('❌ Error fetching activity feed:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch activity feed.'
        });
    }
});



// PUT: Update child progress
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

        // Also update the user's xp and level if user_id exists
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

        // Log activity
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

// GET: Child activities
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
// PARENT ENDPOINTS 👪
// ==========================================

// GET: All parents (for admin)
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

// GET: Pending parents (unverified)
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
            WHERE p.is_verified = false 
            AND p.is_active = true
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

// POST: Verify a parent
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
                const html = `
                    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">
                        <div style="text-align:center;margin-bottom:20px;">
                            <span style="font-size:3rem;">🐼</span>
                            <h2 style="color:#ff416c;margin:10px 0 0 0;">Parent Account Verified!</h2>
                        </div>
                        <p>Hi ${parent.full_name || parent.username || 'Parent'},</p>
                        <p>Great news! Your HanVerse parent account has been <strong>verified</strong> by an administrator.</p>
                        <p>You can now:</p>
                        <ul style="padding-left:20px;margin:16px 0;">
                            <li>✅ Add your children to HanVerse</li>
                            <li>✅ Monitor their learning progress</li>
                            <li>✅ View their achievements</li>
                            <li>✅ Track their daily activity</li>
                        </ul>
                        <p><a href="${getFrontendBaseUrl()}/parent-dashboard.html" style="display:inline-block;padding:12px 24px;background:#ff416c;color:white;text-decoration:none;border-radius:8px;">Go to Dashboard</a></p>
                        <p style="font-size:0.85rem;color:#6b7280;text-align:center;margin-top:30px;">🐼 Happy Learning!</p>
                    </div>
                `;

                await mailer.sendMail({
                    from: EMAIL_FROM,
                    to: parent.email,
                    subject: '🎉 Your HanVerse Parent Account is Verified!',
                    html
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

// POST: Deny a parent
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

        try {
            if (mailer) {
                const html = `
                    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">
                        <div style="text-align:center;margin-bottom:20px;">
                            <span style="font-size:3rem;">📋</span>
                            <h2 style="color:#E63946;margin:10px 0 0 0;">Parent Account Status Update</h2>
                        </div>
                        <p>Hi ${parent.full_name || parent.username || 'Parent'},</p>
                        <p>Your HanVerse parent account application has been reviewed.</p>
                        <p>Unfortunately, we are unable to verify your account at this time.</p>
                        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
                        <p>If you believe this is a mistake, please contact our support team.</p>
                        <p style="font-size:0.85rem;color:#6b7280;text-align:center;margin-top:30px;">🐼 HanVerse Team</p>
                    </div>
                `;

                await mailer.sendMail({
                    from: EMAIL_FROM,
                    to: parent.email,
                    subject: '📋 HanVerse Parent Account Status Update',
                    html
                });
            }
        } catch (mailErr) {
            console.warn('⚠️ Denial email failed:', mailErr.message);
        }

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

// GET: Parent dashboard data
router.get('/parents/dashboard/:parentId', async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { parentId } = req.params;

        const result = await pool.query(`
            SELECT * FROM parent_dashboard_view 
            WHERE parent_id = $1
        `, [parentId]);

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                error: 'Parent not found'
            });
        }

        return res.json({
            success: true,
            dashboard: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error fetching parent dashboard:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch dashboard'
        });
    }
});

// POST: Create parent from user
router.post('/parents/create', async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }

        const userResult = await pool.query(`
            SELECT * FROM users WHERE user_id = $1
        `, [userId]);

        if (!userResult.rows.length) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const user = userResult.rows[0];

        const existingParent = await pool.query(`
            SELECT * FROM parents WHERE user_id = $1
        `, [userId]);

        if (existingParent.rows.length) {
            return res.json({
                success: true,
                message: 'Parent already exists',
                parent: existingParent.rows[0]
            });
        }

        const result = await pool.query(`
            INSERT INTO parents (
                user_id,
                full_name,
                email,
                is_verified,
                created_at,
                updated_at
            ) VALUES ($1, $2, $3, $4, NOW(), NOW())
            RETURNING *
        `, [userId, user.full_name, user.email, user.is_verified]);

        await pool.query(`
            UPDATE users SET role = 'parent' WHERE user_id = $1
        `, [userId]);

        return res.status(201).json({
            success: true,
            message: 'Parent created successfully',
            parent: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error creating parent:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create parent'
        });
    }
});

// PUT: Update parent
router.put('/parents/:parentId', verifyAdminToken, async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { parentId } = req.params;
        const { full_name, email, phone, notification_preferences, language_preference } = req.body;

        const result = await pool.query(`
            UPDATE parents 
            SET 
                full_name = COALESCE($1, full_name),
                email = COALESCE($2, email),
                phone = COALESCE($3, phone),
                notification_preferences = COALESCE($4, notification_preferences),
                language_preference = COALESCE($5, language_preference),
                updated_at = NOW()
            WHERE parent_id = $6
            RETURNING *
        `, [full_name, email, phone, notification_preferences, language_preference, parentId]);

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                error: 'Parent not found'
            });
        }

        return res.json({
            success: true,
            message: 'Parent updated successfully',
            parent: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error updating parent:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update parent'
        });
    }
});

// DELETE: Remove parent (soft delete)
router.delete('/parents/:parentId', verifyAdminToken, async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { parentId } = req.params;

        const result = await pool.query(`
            UPDATE parents 
            SET is_active = false,
                updated_at = NOW()
            WHERE parent_id = $1
            RETURNING *
        `, [parentId]);

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                error: 'Parent not found'
            });
        }

        return res.json({
            success: true,
            message: 'Parent deactivated successfully',
            parent: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error deleting parent:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete parent'
        });
    }
});

// ==========================================
// ADMIN ENDPOINTS 🔐
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
    console.error('❌ Admin verification engine exception:', error);
    return res.status(500).json({ success: false, error: 'Admin validation failed.' });
  }
});

// Fetch Dashboard Overview Metrics
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
    console.error('❌ Loading administrative table payload exception:', error);
    return res.status(500).json({ success: false, error: 'Failed compiling system datasets.' });
  }
});

// Fetch all pending (unverified) accounts
router.get('/admin/pending-parents', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const result = await pool.query(
      `SELECT user_id, username, full_name, email, created_at 
       FROM users 
       WHERE is_verified = false 
       ORDER BY created_at DESC`
    );
    
    return res.json({ success: true, pendingUsers: result.rows });
  } catch (error) {
    console.error('❌ Error fetching pending parents:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch pending accounts' });
  }
});

// Approve a specific pending parent account
router.post('/admin/verify-parent/:id', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const { id } = req.params;
    
    const userResult = await pool.query(
      `SELECT email, username FROM users WHERE user_id = $1`,
      [id]
    );
    
    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    
    const user = userResult.rows[0];
    
    await pool.query(
      `UPDATE users SET is_verified = true WHERE user_id = $1`,
      [id]
    );

    try {
      const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">
          <div style="text-align:center;margin-bottom:20px;">
            <span style="font-size:3rem;">🐼</span>
            <h2 style="color:#ff416c;margin:10px 0 0 0;">Account Verified!</h2>
          </div>
          <p>Hi ${user.username || 'Learner'},</p>
          <p>Great news! Your HanVerse account has been <strong>verified</strong> by an administrator. You now have full access to all features.</p>
          <p>Start your Mandarin learning journey today!</p>
          <p style="font-size:0.85rem;color:#6b7280;text-align:center;margin-top:30px;">🐼 Happy Learning!</p>
        </div>
      `;
      
      if (mailer) {
        await mailer.sendMail({
          from: EMAIL_FROM,
          to: user.email,
          subject: '🎉 Your HanVerse Account is Verified!',
          html
        });
      }
    } catch (mailErr) {
      console.warn('⚠️ Verification email failed:', mailErr.message);
    }
    
    console.log(`✅ Parent account ${id} verified by admin`);
    
    return res.json({ success: true, message: 'Account verified successfully' });
  } catch (error) {
    console.error('❌ Error verifying parent:', error);
    return res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// Send Bulk Email to All Verified Users
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

// Send Individual Direct Email
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

// UPDATE USER DETAILS
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

    // Add role if provided
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

    let changeLogs = [];
    const fieldMappings = {
      premium: { label: 'Premium Membership Status', old: oldUser.premium ? 'Enabled ✨' : 'Disabled', new: premium ? 'Enabled ✨' : 'Disabled' },
      xp: { label: 'Experience Points (XP)', old: `${oldUser.xp} XP`, new: `${xp} XP` },
      level: { label: 'Account Learning Level', old: `Level ${oldUser.level}`, new: `Level ${level}` },
      is_admin: { label: 'Administrative Privileges', old: oldUser.is_admin ? 'Admin' : 'Standard Learner', new: is_admin ? '👑 System Administrator' : 'Standard Learner' },
      is_banned: { label: 'Account Status', old: oldUser.is_banned ? 'Banned' : 'Active', new: is_banned ? '🚫 Banned' : '✅ Active' },
      is_verified: { label: 'Verification Status', old: oldUser.is_verified ? 'Verified' : 'Unverified', new: is_verified ? '✅ Verified' : '⏳ Pending' }
    };

    if (role) {
      fieldMappings.role = { label: 'Role', old: oldUser.role || 'student', new: role };
    }

    for (const [key, mapping] of Object.entries(fieldMappings)) {
      const oldValue = String(oldUser[key] || '');
      const newValue = String(req.body[key] || '');
      if (oldValue !== newValue) {
        changeLogs.push(`<li><strong>${mapping.label}:</strong> Changed from <em>${mapping.old}</em> to <strong>${mapping.new}</strong></li>`);
      }
    }

    if (changeLogs.length > 0) {
      try {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 24px;">
              <span style="font-size: 3rem;">🐼</span>
              <h2 style="color: #ff416c; margin: 10px 0 0 0;">HanVerse Account Modification Notice</h2>
            </div>
            <p>Hi ${username || 'Learner'},</p>
            <p>This message is to officially notify you that <strong>a system administrator has updated your account parameters</strong> on HanVerse. Please review the detailed profile changes below:</p>
            
            <ul style="background-color: #f9fafb; padding: 20px 20px 20px 35px; border-radius: 12px; border-left: 4px solid #ff416c; margin: 20px 0; line-height: 1.8;">
              ${changeLogs.join('')}
            </ul>
            
            <p>If you believe these values were updated in error, please reach out to the support team immediately.</p>
            <p style="font-size: 0.85rem; color: #6b7280; text-align: center; margin-top: 40px; border-top: 1px solid #f3f4f6; padding-top: 20px;">
              Thank you for learning Mandarin with HanVerse!<br>
              🐼 Team HanVerse Support Ops
            </p>
          </div>
        `;

        if (mailer) {
          await mailer.sendMail({
            from: EMAIL_FROM,
            to: email,
            subject: '⚙️ HanVerse Profile Updated by Administrator',
            html: emailHtml
          });
        }
      } catch (mailErr) {
        console.warn('⚠️ Failed to send update notification email:', mailErr.message);
      }
    }

    return res.json({ 
      success: true, 
      message: 'User parameters updated successfully.',
      changes: changeLogs.length
    });

  } catch (error) {
    console.error('❌ Update failure:', error);
    return res.status(500).json({ success: false, error: 'Failed to update user profile.' });
  }
});

// BAN / UNBAN USER
router.post('/admin/users/ban/:id', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const targetUserId = req.params.id;
    const { is_banned, banned_reason } = req.body;

    if (typeof is_banned !== 'boolean') {
      return res.status(400).json({ success: false, error: 'is_banned must be a boolean value.' });
    }

    const userRes = await pool.query(
      `UPDATE users SET is_banned = $1, banned_reason = $2 WHERE user_id = $3 RETURNING email, username`, 
      [is_banned, banned_reason || null, targetUserId]
    );
    
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    
    const user = userRes.rows[0];

    try {
      const subject = is_banned ? '🚨 Account Suspension Notice' : '🟢 Account Restored Notice';
      const messageHtml = is_banned 
        ? `Your account has been suspended by an administrator.${banned_reason ? ` Reason: ${banned_reason}` : ''}` 
        : 'Good news! Your HanVerse account restrictions have been cleared by an administrator, and full access has been restored.';

      const emailHtml = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">
          <div style="text-align:center;">
            <span style="font-size:3rem;">🐼</span>
            <h2 style="color:#ff416c;">HanVerse Security Engine</h2>
          </div>
          <p>Hi ${user.username},</p>
          <p>${messageHtml}</p>
          ${is_banned && banned_reason ? `<p><strong>Reason:</strong> ${banned_reason}</p>` : ''}
          <p style="font-size:0.85rem;color:#6b7280;margin-top:30px;text-align:center;">HanVerse Moderation Desk</p>
        </div>
      `;

      if (mailer) {
        await mailer.sendMail({
          from: EMAIL_FROM,
          to: user.email,
          subject: subject,
          html: emailHtml
        });
      }
    } catch (mailErr) {
      console.warn('⚠️ Ban notification email failed:', mailErr.message);
    }

    return res.json({ 
      success: true, 
      message: `User account successfully ${is_banned ? 'banned' : 'unbanned'}.` 
    });

  } catch (error) {
    console.error('❌ Ban adjustment failure:', error);
    return res.status(500).json({ success: false, error: 'Account modification failed.' });
  }
});

// HARD DELETE USER
router.delete('/admin/users/delete/:id', verifyAdminToken, async (req, res) => {
  try {
    if (!ensurePool(res)) return;

    const targetUserId = req.params.id;

    const targetUserRes = await pool.query(
      `SELECT email, username FROM users WHERE user_id = $1`, 
      [targetUserId]
    );
    
    if (targetUserRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    
    const user = targetUserRes.rows[0];

    try {
      if (mailer) {
        await mailer.sendMail({
          from: EMAIL_FROM,
          to: user.email,
          subject: '❌ HanVerse Account Removed',
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">
              <p>Hi ${user.username},</p>
              <p>This message confirms that an administrator has permanently deleted your HanVerse account profile and all associated learning analytics.</p>
              <p>We are sad to see you go! If you ever wish to resume learning Mandarin, you are welcome to sign up again anytime.</p>
              <p style="text-align:center;margin-top:30px;">🐼 HanVerse Team</p>
            </div>
          `
        });
      }
    } catch(mailErr) {
      console.warn("⚠️ Deletion confirmation email skipped:", mailErr.message);
    }

    await pool.query(`DELETE FROM user_progress WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM user_achievements WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM email_verifications WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [targetUserId]);
    await pool.query(`DELETE FROM users WHERE user_id = $1`, [targetUserId]);

    return res.json({ 
      success: true, 
      message: 'User permanently deleted from the system.' 
    });

  } catch (error) {
    console.error('❌ Deletion failure:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete user.' });
  }
});

// ==========================================
// PANDA AI INTERACTIVE TUTOR 🐼
// ==========================================
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

// ==========================================
// CORE USER AUTHORIZATION: LOGIN 🔑
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
// USER REGISTRATION: SIGNUP 🚀 
// ==========================================
router.post('/signup', async (req, res) => {
  try {
    console.log('📥 Signup request received:', req.body);
    
    if (!ensurePool(res)) return;

    const { username, full_name, email, password, role } = req.body || {};

    // --- VALIDATION ---
    if (!username || !full_name || !email || !password) {
      console.log('❌ Missing fields');
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

    // Validate password length
    if (cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters.'
      });
    }

    // Validate username length
    if (cleanUsername.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters.'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid email address.'
      });
    }

    // --- CHECK EXISTING USER ---
    console.log('🔍 Checking for existing user...');
    const existing = await pool.query(
      `SELECT user_id, email, username FROM users WHERE email = $1 OR username = $2`,
      [cleanEmail, cleanUsername]
    );

    if (existing.rows.length) {
      const conflict = existing.rows[0];
      console.log('⚠️ Existing user found:', conflict);
      
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
    console.log('✅ Creating new user...');
    const password_hash = await bcrypt.hash(cleanPassword, 10);
    const verificationToken = generateToken(24);

    // Check if role column exists
    let hasRoleColumn = false;
    try {
      const columnCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'role'
      `);
      hasRoleColumn = columnCheck.rows.length > 0;
      console.log('📋 Role column exists:', hasRoleColumn);
    } catch (e) {
      console.warn('⚠️ Could not check for role column:', e.message);
    }

    let insertResult;
    if (hasRoleColumn) {
      insertResult = await pool.query(
        `INSERT INTO users (
          username, full_name, email, password_hash, xp, level, streak_days, 
          is_admin, is_banned, is_verified, premium, role, created_at
        ) VALUES ($1, $2, $3, $4, 0, 1, 0, false, false, false, false, $5, NOW())
        RETURNING *`,
        [cleanUsername, cleanFullName, cleanEmail, password_hash, userRole]
      );
    } else {
      insertResult = await pool.query(
        `INSERT INTO users (
          username, full_name, email, password_hash, xp, level, streak_days, 
          is_admin, is_banned, is_verified, premium, created_at
        ) VALUES ($1, $2, $3, $4, 0, 1, 0, false, false, false, false, NOW())
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
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name = 'parents'
        `);
        
        if (tableCheck.rows.length > 0) {
          // Check if parent already exists
          const existingParent = await pool.query(`
              SELECT * FROM parents WHERE user_id = $1
          `, [newUser.user_id]);
          
          if (existingParent.rows.length === 0) {
            await pool.query(`
                INSERT INTO parents (user_id, full_name, email, is_verified, created_at, updated_at)
                VALUES ($1, $2, $3, false, NOW(), NOW())
            `, [newUser.user_id, cleanFullName, cleanEmail]);
            console.log('✅ Parent record created for user:', newUser.user_id);
          } else {
            console.log('ℹ️ Parent record already exists for user:', newUser.user_id);
          }
        }
      } catch (parentError) {
        console.warn('⚠️ Could not create parent record:', parentError.message);
        // Don't fail the signup if parent creation fails
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
        token: verificationToken
      });
      console.log('✅ Verification email sent');
    } catch (mailError) {
      console.warn("⚠️ Verification email could not be sent:", mailError.message);
    }

    // --- RETURN SUCCESS ---
    return res.status(201).json({
      success: true,
      message: "Signup successful. Please check your email for verification.",
      user: safeUser(newUser)
    });

  } catch (error) {
    console.error('❌ Signup error DETAILS:', error);
    console.error('❌ Stack trace:', error.stack);
    return res.status(500).json({
      success: false,
      error: 'Signup failed. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==========================================
// TOKEN AUDITING: VERIFY EMAIL 🧪
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
      `SELECT user_id, token FROM email_verifications 
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
// RESEND VERIFICATION PIPELINE 🔄
// ==========================================
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
      return res.status(404).json({
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
    console.error('❌ Resend verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send verification email.'
    });
  }
});

// ==========================================
// RECOVERY ENGINE: FORGOT PASSWORD 🔓
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
      `SELECT user_id, username FROM users WHERE email = $1`,
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
      // Table might not exist, that's fine
    }

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
// RECOVERY INTEGRATION: RESET PASSWORD 📑
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
// SYNC ENDPOINTS - FIXED (use pool directly)
// ==========================================

// Sync quiz results
app.post('/api/sync/quizzes', async (req, res) => {
  try {
    if (!ensurePool(res)) return;
    
    const { userId, quizzes } = req.body;
    
    // Validate user exists
    const userResult = await pool.query(
      `SELECT user_id FROM users WHERE user_id = $1`,
      [userId]
    );
    
    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Process each quiz - use pool directly
    for (const quiz of quizzes) {
      await pool.query(`
        INSERT INTO quiz_results (user_id, quiz_id, answers, score, timestamp)
        VALUES ($1, $2, $3, $4, $5)
      `, [userId, quiz.quizId, quiz.answers, quiz.score, quiz.timestamp]);
      
      // Update user XP if quiz was completed successfully
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
      // Check if progress exists
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
    
    // Add total XP to user
    await pool.query(`
      UPDATE users SET xp = xp + $1 WHERE user_id = $2
    `, [xp, userId]);
    
    // Log individual XP entries
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
      // Check if already unlocked
      const existing = await pool.query(`
        SELECT 1 FROM user_achievements 
        WHERE user_id = $1 AND achievement_id = $2
      `, [userId, achievement.achievementId]);
      
      if (existing.rows.length === 0) {
        await pool.query(`
          INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, created_at)
          VALUES ($1, $2, $3, NOW())
        `, [userId, achievement.achievementId, achievement.timestamp]);
        
        // Update achievements count
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

// ==========================================
// ROOT DESK INDEX ROUTE 🏡
// ==========================================
router.get('/', (req, res) => {
  return res.json({
    ok: true,
    message: 'HanVerse API',
    version: '1.0.0',
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
// NETLIFY MOUNT & EXPORT ENGINE 🚀
// ==========================================
app.use('/.netlify/functions/server', router);
app.use('/api', router);

const handler = serverless(app);
export { handler };