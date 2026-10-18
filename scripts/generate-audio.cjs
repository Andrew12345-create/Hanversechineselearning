/**
 * Generates Mandarin audio (OpenAI TTS) for lesson vocabulary and dialogue lines,
 * stores MP3s under assets/audio/zh/<sha1>.mp3 and writes audio_url back to the DB.
 *
 * Usage:
 *   node scripts/generate-audio.cjs --dry-run   # list what would be generated
 *   node scripts/generate-audio.cjs             # generate + update DB
 * Idempotent: existing files are reused, DB rows are only set where audio_url is null.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry-run');
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'audio', 'zh');
const VOICE = process.env.TTS_VOICE || 'nova';
const MODEL = process.env.TTS_MODEL || 'tts-1';
const SPEED = Number(process.env.TTS_SPEED || 0.85); // slower for learners

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const sha = (t) => crypto.createHash('sha1').update(`${VOICE}|${SPEED}|${t}`).digest('hex').slice(0, 16);
const publicPath = (t) => `/assets/audio/zh/${sha(t)}.mp3`;
const filePath = (t) => path.join(OUT_DIR, `${sha(t)}.mp3`);

async function synthesize(text) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, speed: SPEED, response_format: 'mp3' })
  });
  if (!res.ok) throw new Error(`TTS failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

(async () => {
  const vocab = await pool.query(`SELECT vocabulary_id, lesson_id, chinese, example_chinese, audio_url FROM lesson_vocabulary ORDER BY lesson_id, order_index`);
  const examples = await pool.query(`SELECT example_id, lesson_id, chinese, audio_url FROM lesson_examples ORDER BY lesson_id, order_index`);

  // Unique Chinese strings across vocab words and example sentences
  const texts = new Set();
  vocab.rows.forEach(r => { if (r.chinese) texts.add(r.chinese.trim()); if (r.example_chinese) texts.add(r.example_chinese.trim()); });
  examples.rows.forEach(r => { if (r.chinese) texts.add(r.chinese.trim()); });
  const list = [...texts];

  console.log(`Unique Chinese strings: ${list.length}`);
  console.log(`Vocab rows: ${vocab.rows.length}, example rows: ${examples.rows.length}`);
  if (DRY) { list.slice(0, 10).forEach(t => console.log('  ', t, '->', publicPath(t))); await pool.end(); return; }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let made = 0, reused = 0;
  for (const t of list) {
    const f = filePath(t);
    if (fs.existsSync(f)) { reused++; continue; }
    fs.writeFileSync(f, await synthesize(t));
    made++;
    process.stdout.write('.');
  }
  console.log(`\nAudio files: ${made} created, ${reused} reused`);

  // Write audio_url for rows that don't have one yet
  let updV = 0, updE = 0;
  for (const r of vocab.rows) {
    if (r.audio_url) continue;
    const src = r.chinese?.trim();
    await pool.query('UPDATE lesson_vocabulary SET audio_url=$1 WHERE vocabulary_id=$2', [publicPath(src), r.vocabulary_id]);
    updV++;
  }
  for (const r of examples.rows) {
    if (r.audio_url) continue;
    await pool.query('UPDATE lesson_examples SET audio_url=$1 WHERE example_id=$2', [publicPath(r.chinese.trim()), r.example_id]);
    updE++;
  }
  console.log(`DB audio_url set: ${updV} vocab rows, ${updE} example rows`);
  await pool.end();
})().catch(async (e) => { console.error('FAILED:', e.message); await pool.end(); process.exitCode = 1; });
