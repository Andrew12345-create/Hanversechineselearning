import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import dotenv from 'dotenv';
import serverless from 'serverless-http';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const { Pool } = pkg;

/* ==========================================
   APP
========================================== */

const app = express();

/* ==========================================
   MIDDLEWARE
========================================== */

app.use(cors());

app.use(express.json({
    limit: '10mb'
}));

app.use(express.urlencoded({
    extended: true
}));

/* ==========================================
   HEALTH CHECKS
========================================== */

app.get('/api/health', (req, res) => {

    res.json({
        ok: true,
        app: 'HanVerse',
        status: 'Running'
    });

});

app.get('/api/routes', (req, res) => {

    res.json({

        routes: [

            '/api/health',
            '/api/login',
            '/api/signup',
            '/api/user/:userId',
            '/api/panda-chat'

        ]

    });

});

/* ==========================================
   DATABASE
========================================== */

function normalizeDatabaseUrl(rawUrl) {

    if (!rawUrl) return null;

    let url = rawUrl.trim();

    url = url.replace(
        /^psql\s+/i,
        ''
    );

    url = url.replace(
        /^['"]|['"]$/g,
        ''
    );

    return url;

}

const databaseUrl =
    normalizeDatabaseUrl(
        process.env.DATABASE_URL ||
        process.env.NEON_DATABASE_URL
    );

let pool = null;

if (databaseUrl) {

    try {

        pool = new Pool({

            connectionString:
                databaseUrl,

            ssl: {
                rejectUnauthorized: false
            }

        });

        pool.query('SELECT 1')
            .then(() => {

                console.log(
                    '✅ Database Connected'
                );

            })
            .catch(error => {

                console.error(
                    '❌ Database Connection Failed:',
                    error.message
                );

            });

    }
    catch (error) {

        console.error(
            '❌ Failed Creating Pool:',
            error.message
        );

    }

}
else {

    console.error(
        '❌ DATABASE_URL Missing'
    );

}

/* ==========================================
   GEMINI AI
========================================== */

const ai = new GoogleGenAI({

    apiKey:
        process.env.GEMINI_API_KEY

});

console.log(
    'Gemini Enabled:',
    !!process.env.GEMINI_API_KEY
);

/* ==========================================
   EMAIL CONFIG
========================================== */

const EMAIL_FROM =
    process.env.EMAIL_FROM ||
    '"HanVerse" <support@hanverse.net>';

const mailer =
    nodemailer.createTransport({

        host:
            'smtp-relay.brevo.com',

        port: 587,

        secure: false,

        auth: {

            user:
                '91f82d001@smtp-brevo.com',

            pass:
                process.env.BREVO_SMTP_KEY

        },

        tls: {
            rejectUnauthorized: false
        }

    });

mailer.verify(error => {

    if (error) {

        console.error(
            '❌ SMTP Error:',
            error.message
        );

    }
    else {

        console.log(
            '✅ SMTP Ready'
        );

    }

});
/* ==========================================
   HELPERS
========================================== */

function dbUnavailable(res) {

    return res.status(500).json({

        success: false,

        error:
            'Database unavailable'

    });

}

function ensurePool(res) {

    if (!pool) {

        dbUnavailable(res);

        return false;

    }

    return true;

}

/* ==========================================
   PANDA AI
========================================== */

app.post('/api/panda-chat', async (req, res) => {

    try {

        const { message } = req.body;

        if (!message) {

            return res.status(400).json({

                success: false,

                error:
                    'Message required'

            });

        }

        const response =
            await ai.models.generateContent({

                model:
                    'gemini-2.5-flash',

                contents: `

You are Panda AI.

You help children aged 5-12 learn Mandarin Chinese.

Rules:

- Use simple English
- Include Pinyin
- Use emojis
- Be encouraging
- Follow YCT curriculum
- Keep answers short

Student Question:

${message}

`

            });

        return res.json({

            success: true,

            reply:
                response.text ||
                '🐼 No response.'

        });

    }
    catch (error) {

        console.error(
            'Panda Error:',
            error
        );

        return res.status(500).json({

            success: false,

            error:
                error.message

        });

    }

});

/* ==========================================
   LOGIN
========================================== */

app.post('/api/login', async (req, res) => {

    try {

        if (!ensurePool(res)) return;

        const {

            email,
            password

        } = req.body;

        if (!email || !password) {

            return res.status(400).json({

                success: false,
                error:
                    'Email and password required'

            });

        }

        const result =
            await pool.query(

                `SELECT *
                 FROM users
                 WHERE email = $1`,

                [email]

            );

        if (!result.rows.length) {

            return res.status(401).json({

                success: false,
                error:
                    'Invalid credentials'

            });

        }

        const user =
            result.rows[0];

        const valid =
            await bcrypt.compare(

                password,
                user.password_hash

            );

        if (!valid) {

            return res.status(401).json({

                success: false,
                error:
                    'Invalid credentials'

            });

        }

        if (user.is_banned) {

            return res.status(403).json({

                success: false,

                error:
                    'banned',

                reason:
                    user.banned_reason

            });

        }

        return res.json({

            success: true,

            user: {

                user_id:
                    user.user_id,

                username:
                    user.username,

                email:
                    user.email,

                full_name:
                    user.full_name,

                xp:
                    user.xp || 0,

                level:
                    user.level || 1,

                streak_days:
                    user.streak_days || 0,

                profile_picture:
                    user.profile_picture,

                is_admin:
                    user.is_admin || false,

                is_banned:
                    user.is_banned || false,

                is_verified:
                    user.is_verified || false,

                premium:
                    user.is_premium || false

            }

        });

    }
    catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            error:
                'Login failed'

        });

    }

});

/* ==========================================
   USER PROFILE
========================================== */

app.get('/api/user/:userId', async (req, res) => {

    try {

        if (!ensurePool(res)) return;

        const { userId } =
            req.params;

        const result =
            await pool.query(

                `SELECT *
                 FROM users
                 WHERE user_id = $1`,

                [userId]

            );

        if (!result.rows.length) {

            return res.status(404).json({

                success: false,
                error:
                    'User not found'

            });

        }

        const user =
            result.rows[0];

        return res.json({

            success: true,

            user: {

                user_id:
                    user.user_id,

                username:
                    user.username,

                full_name:
                    user.full_name,

                email:
                    user.email,

                xp:
                    user.xp,

                level:
                    user.level,

                streak_days:
                    user.streak_days,

                profile_picture:
                    user.profile_picture,

                is_admin:
                    user.is_admin,

                is_banned:
                    user.is_banned,

                banned_reason:
                    user.banned_reason,

                is_verified:
                    user.is_verified,

                premium:
                    user.is_premium,

                chinese_level:
                    user.chinese_level ||
                    'YCT 1'

            }

        });

    }
    catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            error:
                'Profile error'

        });
        

    }
    

});
/* ==========================================
   NETLIFY HANDLER
========================================== */

export const handler = serverless(app);