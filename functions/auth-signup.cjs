// netlify/functions/auth-signup.js
const { Pool } = require('pg');
const crypto = require('crypto'); // Native Node module, zero installations needed

// Initialize the Neon Postgres connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true } 
});

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
    }

    const client = await pool.connect();

    try {
        const { name, email, password, childName, chineseLevel } = JSON.parse(event.body);

        if (!name || !email || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing required fields." }),
            };
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Start database transaction
        await client.query('BEGIN');

        // 1. Check if the user already exists
        const userCheckText = 'SELECT id FROM users WHERE email = $1';
        const userCheckRes = await client.query(userCheckText, [normalizedEmail]);
        
        if (userCheckRes.rows.length > 0) {
            await client.query('ROLLBACK');
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "An account with this email already exists." }),
            };
        }

        // 2. Hash the password using native crypto (PBKDF2)
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
        const secureDbPassword = `${salt}:${hash}`;

        // 3. DUAL-AUTHORIZATION ENGINE
        // Check if student records already exist with this parent email flagged as unlinked
        const preRegCheckText = 'SELECT id FROM students WHERE parent_email = $1 AND parent_id IS NULL';
        const preRegCheckRes = await client.query(preRegCheckText, [normalizedEmail]);
        
        let accountStatus = "pending_approval";
        let message = "Registration successful! Your account is pending admin approval.";
        let autoLinkSuccess = false;

        if (preRegCheckRes.rows.length > 0) {
            accountStatus = "active";
            message = "Account verified and linked successfully! Welcome to HanVerse.";
            autoLinkSuccess = true;
        }

        // 4. Insert the new Parent into the 'users' table
        const insertUserText = `
            INSERT INTO users (name, email, password, role, status, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id;
        `;
        const insertUserRes = await client.query(insertUserText, [
            name, 
            normalizedEmail, 
            secureDbPassword, 
            'parent', 
            accountStatus
        ]);
        
        const newParentId = insertUserRes.rows[0].id;

        // 5. Link or Create Student Profiles with Chinese Track Data
        if (autoLinkSuccess) {
            // Flow A: Link existing pre-registered students to this new parent ID
            const linkStudentsText = 'UPDATE students SET parent_id = $1 WHERE parent_email = $2';
            await client.query(linkStudentsText, [newParentId, normalizedEmail]);
        } else if (childName) {
            // Flow B: Fresh registration, create a new pending student profile with selected target course track
            const insertStudentText = `
                INSERT INTO students (name, current_level, parent_id, parent_email, is_verified)
                VALUES ($1, $2, $3, $4, false);
            `;
            await client.query(insertStudentText, [childName, chineseLevel || 'Not Specified', newParentId, normalizedEmail]);
        }

        // Commit transaction changes
        await client.query('COMMIT');

        return {
            statusCode: 201,
            body: JSON.stringify({
                success: true,
                status: accountStatus,
                message: message,
                token: autoLinkSuccess ? `session_token_${newParentId}` : null 
            }),
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Neon DB Registration error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Internal Server Error during registration." }),
        };
    } finally {
        client.release();
    }
};