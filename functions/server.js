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

// POST: Add a new child
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

// GET: Fetch single child profile
router.get('/parents/child/:childId', async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { childId } = req.params;

        const result = await pool.query(`
            SELECT 
                c.child_id,
                c.user_id,
                c.parent_id,
                c.full_name,
                c.age,
                c.date_of_birth,
                c.grade_level,
                c.level,
                c.xp,
                c.streak_days,
                c.lessons_completed,
                c.achievements_count,
                c.progress_percentage,
                c.is_active,
                c.is_banned,
                c.created_at,
                c.last_active,
                c.last_lesson_at,
                c.notes,
                c.learning_preferences,
                u.username,
                u.email,
                p.full_name as parent_name,
                p.email as parent_email
            FROM children c
            LEFT JOIN users u ON c.user_id = u.user_id
            LEFT JOIN parents p ON c.parent_id = p.parent_id
            WHERE c.child_id = $1
        `, [childId]);

        if (!result.rows.length) {
            return res.status(404).json({ 
                success: false, 
                error: 'Child not found.' 
            });
        }

        return res.json({
            success: true,
            child: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error fetching child profile:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch child profile.'
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
// PARENT-CHILD MANAGEMENT ENDPOINTS 👪
// ==========================================

// GET: Fetch all children for a parent
// GET: Fetch all children for a parent
router.get('/parents/children/:parentId', async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { parentId } = req.params;
        console.log('📥 Fetching children for parent:', parentId);

        // First verify this is a parent account
        const parentResult = await pool.query(
            `SELECT user_id, role, is_verified, is_banned FROM users WHERE user_id = $1`,
            [parentId]
        );

        if (!parentResult.rows.length) {
            return res.status(404).json({ success: false, error: 'Parent not found.' });
        }

        const parent = parentResult.rows[0];

        if (parent.role !== 'parent') {
            return res.status(403).json({ success: false, error: 'User is not a parent.' });
        }

        if (!parent.is_verified) {
            return res.status(403).json({ success: false, error: 'Parent account not verified.' });
        }

        if (parent.is_banned) {
            return res.status(403).json({ success: false, error: 'Parent account is banned.' });
        }

        // Fetch children - check if they're linked via parent_id column or parents table
        let children = [];

        // Try using the parent_id column in users table first
        try {
            const columnCheck = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                AND column_name = 'parent_id'
            `);

            if (columnCheck.rows.length > 0) {
                // First get the parent's parent_id from parents table
                const parentRecord = await pool.query(
                    `SELECT parent_id FROM parents WHERE user_id = $1`,
                    [parentId]
                );

                if (parentRecord.rows.length > 0) {
                    const parentRecordId = parentRecord.rows[0].parent_id;
                    
                    const childrenResult = await pool.query(`
                        SELECT 
                            user_id,
                            username,
                            full_name,
                            email,
                            age,
                            level,
                            xp,
                            streak_days,
                            is_verified,
                            is_banned,
                            lessons_completed,
                            achievements_count,
                            progress_percentage,
                            created_at
                        FROM users 
                        WHERE parent_id = $1
                        AND role = 'student'
                        ORDER BY full_name
                    `, [parentRecordId]);

                    children = childrenResult.rows;
                }
            }
        } catch (e) {
            console.warn('⚠️ Could not fetch children via parent_id:', e.message);
        }

        // If no children found, try alternative method
        if (children.length === 0) {
            try {
                // Try joining with parents table directly
                const childrenResult = await pool.query(`
                    SELECT 
                        u.user_id,
                        u.username,
                        u.full_name,
                        u.email,
                        u.age,
                        u.level,
                        u.xp,
                        u.streak_days,
                        u.is_verified,
                        u.is_banned,
                        u.lessons_completed,
                        u.achievements_count,
                        u.progress_percentage,
                        u.created_at
                    FROM users u
                    JOIN parents p ON p.parent_id = u.parent_id
                    WHERE p.user_id = $1
                    AND u.role = 'student'
                    ORDER BY u.full_name
                `, [parentId]);

                children = childrenResult.rows;
            } catch (e) {
                console.warn('⚠️ Could not fetch children via join:', e.message);
            }
        }

        // Map children data with defaults
        const mappedChildren = children.map(child => ({
            user_id: child.user_id,
            username: child.username || '',
            full_name: child.full_name || 'Child',
            email: child.email || '',
            age: child.age || null,
            level: child.level || 'YCT 1',
            xp: child.xp || 0,
            streak: child.streak_days || 0,
            lessons_completed: child.lessons_completed || 0,
            achievements: child.achievements_count || 0,
            progress: child.progress_percentage || 0,
            is_verified: child.is_verified || false,
            is_banned: child.is_banned || false,
            created_at: child.created_at
        }));

        console.log(`✅ Found ${mappedChildren.length} children for parent ${parentId}`);

        return res.json({
            success: true,
            children: mappedChildren
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
// POST: Add a new child for a parent
// POST: Add a new child (FIXED - No gen_salt)
router.post('/parents/children', async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { parentId, full_name, age, level } = req.body || {};

        console.log('📤 Adding child:', { parentId, full_name, age, level });

        // Validate
        if (!parentId || !full_name || !age) {
            return res.status(400).json({
                success: false,
                error: 'Parent ID, child name, and age are required.'
            });
        }

        if (age < 4 || age > 18) {
            return res.status(400).json({
                success: false,
                error: 'Age must be between 4 and 18.'
            });
        }

        // Verify parent exists and is verified
        const parentResult = await pool.query(`
            SELECT p.parent_id, u.user_id, u.is_verified, u.is_banned, u.email 
            FROM parents p
            JOIN users u ON p.user_id = u.user_id
            WHERE p.parent_id = $1 OR p.user_id = $1
        `, [parentId]);

        if (!parentResult.rows.length) {
            return res.status(404).json({
                success: false,
                error: 'Parent not found.'
            });
        }

        const parent = parentResult.rows[0];
        const parentRecordId = parent.parent_id;

        if (!parent.is_verified) {
            return res.status(403).json({
                success: false,
                error: 'Parent account not verified.'
            });
        }

        if (parent.is_banned) {
            return res.status(403).json({
                success: false,
                error: 'Parent account is banned.'
            });
        }

        // Check if children table exists
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name = 'children'
        `);

        if (tableCheck.rows.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'Children table not found. Please run database migrations.'
            });
        }

        // Generate username and email for the child
        const baseUsername = full_name.toLowerCase().replace(/\s/g, '');
        const timestamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
        let username = `${baseUsername}_${timestamp}`;
        
        // Make username unique
        let counter = 0;
        let unique = false;
        while (!unique) {
            const check = await pool.query(`SELECT 1 FROM users WHERE username = $1`, [username]);
            if (check.rows.length === 0) {
                unique = true;
            } else {
                counter++;
                username = `${baseUsername}_${timestamp}_${counter}`;
            }
        }
        
        const email = `${username}@hanverse.child`;
        
        // Generate temporary password (8 characters)
        const tempPassword = Math.random().toString(36).substring(2, 10);
        const password_hash = await bcrypt.hash(tempPassword, 10);

        // Create user account for the child
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
        `, [username, full_name, email, password_hash]);

        const childUserId = userResult.rows[0].user_id;

        // Insert child into children table
        const insertResult = await pool.query(`
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
        `, [parentRecordId, childUserId, full_name, age, level || 'YCT 1', username, email, password_hash]);

        const newChild = insertResult.rows[0];

        console.log('✅ Child created:', newChild);

        // Log activity
        try {
            await pool.query(`
                INSERT INTO child_activities (child_id, type, message, created_at)
                VALUES ($1, 'child_added', $2, NOW())
            `, [newChild.child_id, `Child ${full_name} was added by parent`]);
        } catch (logError) {
            console.warn('⚠️ Could not log activity:', logError.message);
        }

        // Send confirmation email to parent
        try {
            if (mailer) {
                const html = `
                    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">
                        <div style="text-align:center;margin-bottom:20px;">
                            <span style="font-size:3rem;">👶</span>
                            <h2 style="color:#ff416c;margin:10px 0 0 0;">Child Added to HanVerse!</h2>
                        </div>
                        <p>Hi Parent,</p>
                        <p><strong>${full_name}</strong> has been successfully added to your HanVerse account!</p>
                        <div style="background-color:#f9fafb;padding:15px;border-radius:8px;margin:20px 0;">
                            <p style="margin:4px 0;"><strong>Name:</strong> ${full_name}</p>
                            <p style="margin:4px 0;"><strong>Age:</strong> ${age}</p>
                            <p style="margin:4px 0;"><strong>Level:</strong> ${level || 'YCT 1'}</p>
                            <p style="margin:4px 0;"><strong>Username:</strong> ${username}</p>
                            <p style="margin:4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
                        </div>
                        <p>Your child can now start learning Mandarin with Panda AI! 🐼</p>
                        <p style="font-size:0.85rem;color:#6b7280;text-align:center;margin-top:30px;">
                            🐼 Happy Learning!
                        </p>
                    </div>
                `;

                await mailer.sendMail({
                    from: EMAIL_FROM,
                    to: parent.email,
                    subject: `👶 ${full_name} Added to HanVerse!`,
                    html
                });
                console.log('✅ Confirmation email sent to parent');
            }
        } catch (mailErr) {
            console.warn('⚠️ Child addition email failed:', mailErr.message);
        }

        return res.status(201).json({
            success: true,
            message: `Child ${full_name} added successfully!`,
            child: {
                child_id: newChild.child_id,
                user_id: newChild.user_id,
                full_name: newChild.full_name,
                age: newChild.age,
                level: newChild.level,
                username: newChild.username || '',
                email: newChild.email || '',
                tempPassword: tempPassword // Only for initial creation
            }
        });

    } catch (error) {
        console.error('❌ Error adding child:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to add child. Please try again.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET: Fetch activity feed for a parent's children
router.get('/parents/activity/:parentId', async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { parentId } = req.params;

        // Verify parent exists
        const parentResult = await pool.query(
            `SELECT user_id FROM users WHERE user_id = $1 AND role = 'parent'`,
            [parentId]
        );

        if (!parentResult.rows.length) {
            return res.status(404).json({ success: false, error: 'Parent not found.' });
        }

        // Try to fetch from activities table
        try {
            const tableCheck = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_name = 'activities'
            `);

            if (tableCheck.rows.length > 0) {
                const activitiesResult = await pool.query(`
                    SELECT 
                        a.activity_id,
                        a.type,
                        a.message,
                        a.created_at,
                        u.full_name as child_name
                    FROM activities a
                    LEFT JOIN users u ON a.child_id = u.user_id
                    WHERE a.user_id = $1
                    ORDER BY a.created_at DESC
                    LIMIT 20
                `, [parentId]);

                if (activitiesResult.rows.length > 0) {
                    return res.json({
                        success: true,
                        activities: activitiesResult.rows
                    });
                }
            }
        } catch (e) {
            console.warn('⚠️ Could not fetch activities:', e.message);
        }

        // Return empty array if no activities found
        return res.json({
            success: true,
            activities: []
        });

    } catch (error) {
        console.error('❌ Error fetching activity feed:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch activity feed.'
        });
    }
});

// GET: Fetch a single child's profile
router.get('/parents/child/:childId', async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { childId } = req.params;

        const result = await pool.query(`
            SELECT 
                user_id,
                full_name,
                age,
                level,
                xp,
                streak_days,
                is_verified,
                is_banned,
                premium,
                lessons_completed,
                achievements_count,
                progress_percentage,
                created_at
            FROM users
            WHERE user_id = $1 AND role = 'student'
        `, [childId]);

        if (!result.rows.length) {
            return res.status(404).json({ success: false, error: 'Child not found.' });
        }

        return res.json({
            success: true,
            child: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error fetching child profile:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch child profile.'
        });
    }
});

// PUT: Update child progress
router.put('/parents/child/:childId/progress', async (req, res) => {
    try {
        if (!ensurePool(res)) return;

        const { childId } = req.params;
        const { lessons_completed, achievements, progress, xp, level } = req.body;

        const result = await pool.query(`
            UPDATE users 
            SET 
                lessons_completed = COALESCE($1, lessons_completed),
                achievements_count = COALESCE($2, achievements_count),
                progress_percentage = COALESCE($3, progress_percentage),
                xp = COALESCE($4, xp),
                level = COALESCE($5, level),
                updated_at = NOW()
            WHERE user_id = $6 AND role = 'student'
            RETURNING user_id, full_name, lessons_completed, achievements_count, progress_percentage, xp, level
        `, [lessons_completed, achievements, progress, xp, level, childId]);

        if (!result.rows.length) {
            return res.status(404).json({ success: false, error: 'Child not found.' });
        }

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
// ==========================================
// PARENT VERIFICATION FUNCTIONS - FIXED
// ==========================================

// Verify a parent
async function verifyParent(parentId, parentName) {
    if (!parentId) {
        showToast('❌ Error: Parent ID is missing.', 'error');
        return;
    }

    if (!confirm(`✅ Verify parent "${parentName || 'Unknown'}"? They will get full access to the Parent Hub.`)) return;

    try {
        const adminUserId = getAdminUserId();
        
        const res = await fetch(`${CONFIG.API_URL}/admin/parents/verify/${parentId}`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ adminUserId: adminUserId })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Verification failed');
        }

        showToast(`✅ ${parentName || 'Parent'} has been verified!`, 'success');
        await loadAdminData();

    } catch (err) {
        console.error('❌ Verify error:', err);
        showToast(`❌ Error: ${err.message}`, 'error');
    }
}

// Deny a parent (with reason prompt)
async function denyParent(parentId, parentName) {
    if (!parentId) {
        showToast('❌ Error: Parent ID is missing.', 'error');
        return;
    }

    const reason = prompt(`Why are you denying "${parentName || 'Parent'}"? (Optional)`, '');
    if (reason === null) return; // User cancelled

    if (!confirm(`❌ Deny parent "${parentName || 'Unknown'}"? This will remove their parent access.`)) return;

    try {
        const adminUserId = getAdminUserId();
        
        const res = await fetch(`${CONFIG.API_URL}/admin/parents/deny/${parentId}`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ 
                reason: reason || 'Not specified',
                adminUserId: adminUserId 
            })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Denial failed');
        }

        showToast(`❌ ${parentName || 'Parent'} has been denied parent access.`, 'error');
        await loadAdminData();

    } catch (err) {
        console.error('❌ Deny error:', err);
        showToast(`❌ Error: ${err.message}`, 'error');
    }
}

// Get admin user ID from localStorage
function getAdminUserId() {
    try {
        const user = JSON.parse(localStorage.getItem('hanverse_user') || '{}');
        return user.user_id || null;
    } catch {
        return null;
    }
}
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
// USER PROFILE ACCESS 👤
// ==========================================
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
        error: 'User not found.'
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
      error: 'Failed to fetch user profile.'
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
// server.js - Sync endpoints

// Sync quiz results
app.post('/api/sync/quizzes', async (req, res) => {
  try {
    const { userId, quizzes } = req.body;
    
    // Validate user
    const user = await db.users.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Process each quiz
    for (const quiz of quizzes) {
      await db.quizResults.create({
        userId,
        quizId: quiz.quizId,
        answers: quiz.answers,
        score: quiz.score,
        timestamp: quiz.timestamp
      });
      
      // Update user XP if quiz was completed successfully
      if (quiz.score >= 70) {
        await db.users.addXP(userId, 10); // Example: 10 XP per passed quiz
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
    const { userId, progress } = req.body;
    
    for (const item of progress) {
      await db.progress.upsert({
        userId,
        lessonId: item.lessonId,
        completed: item.completed,
        score: item.score,
        xpEarned: item.xpEarned,
        timestamp: item.timestamp
      });
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
    const { userId, xp, entries } = req.body;
    
    // Add total XP
    await db.users.addXP(userId, xp);
    
    // Log individual XP entries
    for (const entry of entries) {
      await db.xpLogs.create({
        userId,
        amount: entry.xp,
        source: entry.source,
        timestamp: entry.timestamp
      });
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
    const { userId, achievements } = req.body;
    
    for (const achievement of achievements) {
      await db.achievements.unlock({
        userId,
        achievementId: achievement.achievementId,
        timestamp: achievement.timestamp
      });
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
    const { userId, count, lastDate } = req.body;
    
    await db.users.updateStreak(userId, {
      count,
      lastDate
    });
    
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