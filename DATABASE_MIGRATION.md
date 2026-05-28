# Database Migration Guide

## Update User Passwords

If you have existing users with plain text passwords in your database, you'll need to hash them using bcrypt. Here's a script to do that:

### Option 1: Manual Update (Using Node.js)

Create a file called `migrate-passwords.js`:

```javascript
import pkg from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migratePasswords() {
  try {
    const result = await pool.query('SELECT user_id, password_hash FROM users');
    
    for (const user of result.rows) {
      // Check if password is already hashed (bcrypt hashes start with $2a$, $2b$, or $2y$)
      if (!user.password_hash.startsWith('$2')) {
        const hashedPassword = await bcrypt.hash(user.password_hash, 10);
        await pool.query(
          'UPDATE users SET password_hash = $1 WHERE user_id = $2',
          [hashedPassword, user.user_id]
        );
        console.log(`Migrated user ${user.user_id}`);
      }
    }
    
    console.log('Migration complete!');
  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    await pool.end();
  }
}

migratePasswords();
```

Run it with:
```bash
node migrate-passwords.js
```

### Option 2: Direct SQL Update

If you want to add test users with hashed passwords:

```sql
-- First, install the pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Insert a test user with hashed password
-- Password: 'password123'
INSERT INTO users (username, email, password_hash, full_name, last_active)
VALUES (
  'testuser',
  'test@example.com',
  '$2b$10$Kn1KnjZpmdphHY/jJKFaP.OlXgVfwJKz5xWr1gIdl0EGMYxNbJqnS', -- bcrypt hash of 'password123'
  'Test User',
  CURRENT_DATE
);

-- Create default settings for the user
INSERT INTO user_settings (user_id)
VALUES ((SELECT user_id FROM users WHERE email = 'test@example.com'));
```

## Verify Password Hashing

Test that the backend correctly hashes passwords:

```bash
npm start
```

Then test the login endpoint:
```bash
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

Should return user data if successful.

## Ensure All Tables Exist

Run your `database_schema.sql` on the Neon database:

```bash
psql postgresql://neondb_owner:npg_2GbziUBo9RvI@ep-little-brook-airyxne9-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require < database_schema.sql
```

Or through Neon console:
1. Go to Neon console
2. Open SQL Editor
3. Paste the contents of `database_schema.sql`
4. Execute
