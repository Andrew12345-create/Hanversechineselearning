import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  const res = await pool.query('SELECT user_id, username, email FROM users LIMIT 5');
  console.log(JSON.stringify(res.rows, null, 2));
} catch (e) {
  console.error('DB query failed', e);
} finally {
  await pool.end();
}
