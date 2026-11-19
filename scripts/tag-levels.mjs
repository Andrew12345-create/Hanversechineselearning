#!/usr/bin/env node
// Tags dictionary_entries.level from vocabulary we actually teach.
//
// Source of truth is our own lesson data: lesson_vocabulary joined to
// lessons.level. A word is tagged with the lowest level whose lesson teaches
// it, so the dictionary chip means "taught in our YCT N lessons" and never
// claims an official YCT syllabus match.
//
// An optional official list can be layered in with --list <file>, one entry
// per line as "hanzi<TAB>level" or "hanzi,level". Nothing is written unless
// --confirm is passed; the default is a dry run that only prints counts.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const listIndex = args.indexOf('--list');
const listFile = listIndex >= 0 ? args[listIndex + 1] : null;

function readList(file) {
  const rows = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\t|,/).map(p => p.trim());
    const level = Number(parts[1]);
    if (!parts[0] || !Number.isInteger(level) || level < 1 || level > 4) continue;
    rows.push({ hanzi: parts[0], level });
  }
  return rows;
}

const { default: dotenv } = await import('dotenv');
dotenv.config();
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const { default: pg } = await import('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  const taught = await pool.query(
    `SELECT lv.chinese AS hanzi, MIN(l.level)::int AS level
     FROM lesson_vocabulary lv
     JOIN lessons l ON l.lesson_id = lv.lesson_id
     WHERE l.level BETWEEN 1 AND 4 AND lv.chinese IS NOT NULL
     GROUP BY lv.chinese`
  );
  const wanted = new Map();
  for (const row of taught.rows) {
    const hanzi = String(row.hanzi || '').trim();
    if (hanzi) wanted.set(hanzi, row.level);
  }
  const fromLessons = wanted.size;

  if (listFile) {
    for (const row of readList(listFile)) {
      if (!wanted.has(row.hanzi)) wanted.set(row.hanzi, row.level);
    }
  }

  const hanzi = [...wanted.keys()];
  const levels = hanzi.map(h => wanted.get(h));
  const matched = hanzi.length
    ? await pool.query(
        `SELECT COUNT(*)::int AS n FROM dictionary_entries WHERE hanzi = ANY($1::text[])`,
        [hanzi]
      )
    : { rows: [{ n: 0 }] };

  console.log(`lesson vocabulary: ${fromLessons} words`);
  if (listFile) console.log(`official list: ${wanted.size - fromLessons} extra words from ${listFile}`);
  console.log(`dictionary rows that would be tagged: ${matched.rows[0].n} of ${hanzi.length} words`);

  if (!confirm) {
    console.log('dry run: nothing written. Re-run with --confirm to write levels.');
    process.exit(0);
  }

  const result = await pool.query(
    `UPDATE dictionary_entries AS d
     SET level = v.level
     FROM (SELECT unnest($1::text[]) AS hanzi, unnest($2::int[]) AS level) AS v
     WHERE d.hanzi = v.hanzi AND d.level IS DISTINCT FROM v.level`,
    [hanzi, levels]
  );
  console.log(`tagged ${result.rowCount} rows`);
} finally {
  await pool.end();
}
