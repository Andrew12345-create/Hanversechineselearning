/** Adds audio_url to lesson_quiz_questions (for listening exercises). Idempotent. */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await pool.query('ALTER TABLE lesson_quiz_questions ADD COLUMN IF NOT EXISTS audio_url TEXT');
  console.log('ok: lesson_quiz_questions.audio_url ready');
  process.exit(0);
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
