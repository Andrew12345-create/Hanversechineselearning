#!/usr/bin/env node
// Imports CC-CEDICT (CC BY-SA 4.0) into dictionary_entries.
// Usage: node scripts/import-cedict.mjs <cedict_ts.u8> [--confirm]
// Without --confirm it only parses and prints counts; it never connects to the database.
// Existing rows (admin edits, reviewed entries) are never overwritten.

import { readFileSync } from 'node:fs';
import { parseCedict } from './cedict-lib.mjs';

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const file = args.find(a => !a.startsWith('--'));
if (!file) {
  console.error('Usage: node scripts/import-cedict.mjs <cedict_ts.u8> [--confirm]');
  process.exit(2);
}

const { entries, lines, skipped } = parseCedict(readFileSync(file, 'utf8'));
console.log(`parsed ${lines} source lines -> ${entries.length} entries (${skipped} skipped)`);

if (!confirm) {
  console.log('dry run: nothing written. Re-run with --confirm to write to DATABASE_URL.');
  process.exit(0);
}

const { default: dotenv } = await import('dotenv');
dotenv.config();
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const { default: pg } = await import('pg');
const { ensureDictionarySchema } = await import('../functions/dictionary.js');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const CHUNK = 1000;
let inserted = 0;
try {
  await ensureDictionarySchema(pool);
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    const params = [];
    const rows = slice.map((e, n) => {
      params.push(e.hanzi, e.traditional || null, e.pinyin, e.pinyinPlain, e.meaning);
      const b = n * 5;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, 'cc-cedict', FALSE)`;
    });
    const result = await pool.query(
      `INSERT INTO dictionary_entries (hanzi, traditional, pinyin, pinyin_plain, meaning, source, reviewed)
       VALUES ${rows.join(',')}
       ON CONFLICT (hanzi, pinyin) DO NOTHING`,
      params
    );
    inserted += result.rowCount;
    if ((i / CHUNK) % 25 === 0) console.log(`  ${Math.min(i + CHUNK, entries.length)}/${entries.length}`);
  }
  const total = await pool.query('SELECT COUNT(*)::int AS n FROM dictionary_entries');
  console.log(`inserted ${inserted}, already present ${entries.length - inserted}, table now ${total.rows[0].n} rows`);
} finally {
  await pool.end();
}
