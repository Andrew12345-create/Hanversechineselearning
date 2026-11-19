/* =========================================================
   HANVERSE DICTIONARY — searchable hanzi / pinyin / meaning
   entries, learner saves, and an admin review workflow.

   Design notes:
   - Schema changes are idempotent, like features.js, so they are
     safe to run on every boot.
   - Search is read-only and public; saves require a verified JWT.
   - Every entry carries `reviewed`. Unreviewed entries are shown
     with a badge and are never described as YCT-aligned, because
     HanVerse does not claim alignment it has not had checked.
   ========================================================= */
import rateLimit from 'express-rate-limit';

let pool = null;
let schemaReady = false;

const ok = (res, json) => res.json({ success: true, ...json });
const fail = (res, code, error) => res.status(code).json({ success: false, error });

/* Tone marks are stripped for search so "nihao", "nǐ hǎo" and "nǐhǎo"
   all reach the same row. Stored alongside the accented pinyin. */
const TONE_MAP = {
  'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
  'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
  'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
  'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
  'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
  'ǖ': 'v', 'ǘ': 'v', 'ǚ': 'v', 'ǜ': 'v', 'ü': 'v',
  'ń': 'n', 'ň': 'n', 'ǹ': 'n', 'ḿ': 'm'
};

export function plainPinyin(value) {
  return String(value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿ]/g, ch => TONE_MAP[ch] || ch)
    .replace(/[\s'-]+/g, '')
    .trim();
}

const STARTER_ENTRIES = [
  { hanzi: '你好', pinyin: 'nǐ hǎo', meaning: 'hello', pos: 'phrase' },
  { hanzi: '谢谢', pinyin: 'xiè xie', meaning: 'thank you', pos: 'phrase' },
  { hanzi: '再见', pinyin: 'zài jiàn', meaning: 'goodbye; see you again', pos: 'phrase' },
  { hanzi: '妈妈', pinyin: 'mā ma', meaning: 'mother; mum', pos: 'noun' },
  { hanzi: '爸爸', pinyin: 'bà ba', meaning: 'father; dad', pos: 'noun' },
  { hanzi: '红色', pinyin: 'hóng sè', meaning: 'red', pos: 'noun' },
  { hanzi: '米饭', pinyin: 'mǐ fàn', meaning: 'cooked rice', pos: 'noun' },
  { hanzi: '图书馆', pinyin: 'tú shū guǎn', meaning: 'library', pos: 'noun' },
  { hanzi: '七', pinyin: 'qī', meaning: 'seven', pos: 'number' },
  { hanzi: '今天', pinyin: 'jīn tiān', meaning: 'today', pos: 'noun' }
];

export async function ensureDictionarySchema(pgPool) {
  if (schemaReady) return;
  pgPool = pgPool || pool;
  if (!pgPool) throw new Error('No database pool provided');
  pool = pgPool;
  const q = sql => pool.query(sql);

  await q(`CREATE TABLE IF NOT EXISTS dictionary_entries (
    entry_id SERIAL PRIMARY KEY,
    hanzi VARCHAR(40) NOT NULL,
    pinyin VARCHAR(160) NOT NULL,
    pinyin_plain VARCHAR(160) NOT NULL,
    meaning VARCHAR(400) NOT NULL,
    part_of_speech VARCHAR(32),
    measure_word VARCHAR(24),
    level SMALLINT,
    example_hanzi TEXT,
    example_pinyin TEXT,
    example_meaning TEXT,
    reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_by INTEGER REFERENCES users(user_id),
    reviewed_at TIMESTAMPTZ,
    source VARCHAR(32) NOT NULL DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  /* CC-CEDICT senses run to 669 characters and a word can have several
     readings that differ only by tone (好 hǎo / hào), so `meaning` is TEXT
     and a row is keyed by (hanzi, pinyin) rather than the tone-stripped form.
     varchar -> text is a metadata-only change; it is guarded so the lock is
     only taken once. */
  const meaningType = await pool.query(
    `SELECT data_type FROM information_schema.columns
      WHERE table_name = 'dictionary_entries' AND column_name = 'meaning'`
  );
  if (meaningType.rows[0] && meaningType.rows[0].data_type !== 'text') {
    await q(`ALTER TABLE dictionary_entries ALTER COLUMN meaning TYPE TEXT`);
  }
  await q(`ALTER TABLE dictionary_entries ADD COLUMN IF NOT EXISTS traditional VARCHAR(120)`);

  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_hanzi_reading
           ON dictionary_entries (hanzi, pinyin)`);
  await q(`DROP INDEX IF EXISTS idx_dictionary_hanzi_pinyin`);
  await q(`CREATE INDEX IF NOT EXISTS idx_dictionary_hanzi ON dictionary_entries (hanzi)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_dictionary_pinyin_plain ON dictionary_entries (pinyin_plain)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_dictionary_level ON dictionary_entries (level)`);
  try {
    await q(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await q(`CREATE INDEX IF NOT EXISTS idx_dictionary_hanzi_trgm ON dictionary_entries USING gin (hanzi gin_trgm_ops)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_dictionary_pinyin_trgm ON dictionary_entries USING gin (pinyin_plain gin_trgm_ops)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_dictionary_meaning_trgm ON dictionary_entries USING gin (LOWER(meaning) gin_trgm_ops)`);
  } catch (error) {
    console.warn('dictionary: pg_trgm unavailable, substring search will be slower:', error.message);
  }
  await q(`CREATE INDEX IF NOT EXISTS idx_dictionary_reviewed ON dictionary_entries (reviewed)`);

  await q(`CREATE TABLE IF NOT EXISTS dictionary_saves (
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    entry_id INTEGER NOT NULL REFERENCES dictionary_entries(entry_id) ON DELETE CASCADE,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, entry_id)
  )`);

  // Starter rows are inserted unreviewed and only if the table is empty, so a
  // real dictionary is never overwritten by a boot.
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM dictionary_entries');
  if (count.rows[0].n === 0) {
    for (const entry of STARTER_ENTRIES) {
      await pool.query(
        `INSERT INTO dictionary_entries (hanzi, pinyin, pinyin_plain, meaning, part_of_speech, source)
         VALUES ($1, $2, $3, $4, $5, 'starter')
         ON CONFLICT (hanzi, pinyin) DO NOTHING`,
        [entry.hanzi, entry.pinyin, plainPinyin(entry.pinyin), entry.meaning, entry.pos]
      );
    }
  }

  schemaReady = true;
}

const PUBLIC_COLUMNS = `entry_id, hanzi, traditional, pinyin, meaning, part_of_speech,
  measure_word, level, example_hanzi, example_pinyin, example_meaning,
  reviewed, source`;

function shape(row, savedIds) {
  return {
    id: row.entry_id,
    hanzi: row.hanzi,
    traditional: row.traditional || null,
    pinyin: row.pinyin,
    meaning: row.meaning,
    partOfSpeech: row.part_of_speech || null,
    measureWord: row.measure_word || null,
    level: row.level === null || row.level === undefined ? null : Number(row.level),
    example: row.example_hanzi
      ? { hanzi: row.example_hanzi, pinyin: row.example_pinyin || null, meaning: row.example_meaning || null }
      : null,
    reviewed: row.reviewed === true,
    source: row.source,
    saved: savedIds ? savedIds.has(row.entry_id) : false
  };
}

export function registerDictionaryRoutes(router, pgPool, opts = {}) {
  pool = pgPool;

  if (typeof opts.requireUser !== 'function') {
    throw new Error('dictionary.js requires the shared user authenticator — refusing to mount unauthenticated routes');
  }
  if (typeof opts.verifyAdminToken !== 'function') {
    throw new Error('dictionary.js requires the shared admin verifier — refusing to mount admin routes without authorization');
  }
  const requireAuth = (req, res, next) => {
    Promise.resolve(opts.requireUser(req, res)).then(user => {
      if (!user) return;
      const id = Number(user.user_id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 401, 'Session expired — please sign in again');
      req.userId = id;
      next();
    }).catch(error => {
      console.error('dictionary auth:', error.message);
      if (!res.headersSent) fail(res, 500, 'Authentication failed');
    });
  };
  const requireAdmin = opts.verifyAdminToken;

  const searchLimiter = rateLimit({
    keyGenerator: req => {
      const h = req.headers || {};
      return (req.ip || h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || 'anon').split(',')[0].trim();
    },
    validate: false,
    windowMs: 60 * 1000,
    max: 90,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many searches — please slow down.' }
  });

  /* ---------- public search ---------- */
  router.get('/dictionary/search', searchLimiter, async (req, res) => {
    try {
      await ensureDictionarySchema();
      const raw = String(req.query.q || '').trim().slice(0, 60);
      const level = req.query.level === undefined || req.query.level === '' ? null : Number(req.query.level);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      if (level !== null && ![1, 2, 3, 4].includes(level)) {
        return fail(res, 400, 'level must be 1, 2, 3 or 4');
      }

      const where = [];
      const params = [];
      let rank = '0';
      if (raw) {
        const plain = plainPinyin(raw);
        params.push(`%${raw}%`, `%${plain}%`, `%${raw.toLowerCase()}%`);
        where.push(`(hanzi LIKE $1 OR pinyin_plain LIKE $2 OR LOWER(meaning) LIKE $3)`);
      }
      if (level !== null) {
        params.push(level);
        where.push(`level = $${params.length}`);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const countParams = params.slice();
      if (raw) {
        params.push(raw, plainPinyin(raw));
        const a = params.length - 1;
        const b = params.length;
        rank = `CASE WHEN hanzi = $${a} THEN 0 WHEN pinyin_plain = $${b} THEN 1
                     WHEN hanzi LIKE $${a} || '%' THEN 2 WHEN pinyin_plain LIKE $${b} || '%' THEN 3 ELSE 4 END`;
      }
      params.push(limit, offset);
      const rows = await pool.query(
        `SELECT ${PUBLIC_COLUMNS} FROM dictionary_entries
         ${clause}
         ORDER BY ${rank}, reviewed DESC, level NULLS LAST, char_length(hanzi), hanzi, entry_id
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      const total = await pool.query(
        `SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM dictionary_entries ${clause} LIMIT 1000) capped`,
        countParams
      );

      ok(res, {
        query: raw,
        level,
        total: total.rows[0].n,
        limit,
        offset,
        results: rows.rows.map(row => shape(row))
      });
    } catch (error) {
      console.error('dictionary search:', error.message);
      if (!res.headersSent) fail(res, 500, 'Could not search the dictionary');
    }
  });

  router.get('/dictionary/levels', searchLimiter, async (req, res) => {
    try {
      await ensureDictionarySchema();
      const rows = await pool.query(
        `SELECT level, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE reviewed)::int AS reviewed
         FROM dictionary_entries GROUP BY level ORDER BY level NULLS LAST`
      );
      ok(res, {
        levels: rows.rows.map(r => ({
          level: r.level === null ? null : Number(r.level),
          total: r.total,
          reviewed: r.reviewed
        }))
      });
    } catch (error) {
      console.error('dictionary levels:', error.message);
      if (!res.headersSent) fail(res, 500, 'Could not load dictionary levels');
    }
  });

  router.get('/dictionary/word/:id', searchLimiter, async (req, res) => {
    try {
      await ensureDictionarySchema();
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid entry id');
      const row = await pool.query(
        `SELECT ${PUBLIC_COLUMNS} FROM dictionary_entries WHERE entry_id = $1`,
        [id]
      );
      if (!row.rows.length) return fail(res, 404, 'Entry not found');
      ok(res, { entry: shape(row.rows[0]) });
    } catch (error) {
      console.error('dictionary word:', error.message);
      if (!res.headersSent) fail(res, 500, 'Could not load that entry');
    }
  });

  /* ---------- learner saves ---------- */
  router.get('/dictionary/saves', requireAuth, async (req, res) => {
    try {
      await ensureDictionarySchema();
      const rows = await pool.query(
        `SELECT ${PUBLIC_COLUMNS.split(',').map(c => `e.${c.trim()}`).join(', ')}, s.saved_at
         FROM dictionary_saves s
         JOIN dictionary_entries e ON e.entry_id = s.entry_id
         WHERE s.user_id = $1
         ORDER BY s.saved_at DESC
         LIMIT 200`,
        [req.userId]
      );
      ok(res, { entries: rows.rows.map(row => ({ ...shape(row), savedAt: row.saved_at })) });
    } catch (error) {
      console.error('dictionary saves:', error.message);
      if (!res.headersSent) fail(res, 500, 'Could not load saved words');
    }
  });

  router.post('/dictionary/saves/:id', requireAuth, async (req, res) => {
    try {
      await ensureDictionarySchema();
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid entry id');
      const exists = await pool.query('SELECT 1 FROM dictionary_entries WHERE entry_id = $1', [id]);
      if (!exists.rows.length) return fail(res, 404, 'Entry not found');
      await pool.query(
        `INSERT INTO dictionary_saves (user_id, entry_id) VALUES ($1, $2)
         ON CONFLICT (user_id, entry_id) DO NOTHING`,
        [req.userId, id]
      );
      ok(res, { saved: true, entryId: id });
    } catch (error) {
      console.error('dictionary save:', error.message);
      if (!res.headersSent) fail(res, 500, 'Could not save that word');
    }
  });

  router.delete('/dictionary/saves/:id', requireAuth, async (req, res) => {
    try {
      await ensureDictionarySchema();
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid entry id');
      await pool.query(
        'DELETE FROM dictionary_saves WHERE user_id = $1 AND entry_id = $2',
        [req.userId, id]
      );
      ok(res, { saved: false, entryId: id });
    } catch (error) {
      console.error('dictionary unsave:', error.message);
      if (!res.headersSent) fail(res, 500, 'Could not remove that word');
    }
  });

  /* ---------- admin authoring ---------- */
  router.post('/admin/dictionary', requireAdmin, async (req, res) => {
    try {
      await ensureDictionarySchema();
      const body = req.body || {};
      const hanzi = String(body.hanzi || '').trim().slice(0, 40);
      const pinyin = String(body.pinyin || '').trim().slice(0, 160);
      const meaning = String(body.meaning || '').trim().slice(0, 1000);
      if (!hanzi || !pinyin || !meaning) return fail(res, 400, 'hanzi, pinyin and meaning are required');

      const level = body.level === undefined || body.level === null || body.level === ''
        ? null
        : Number(body.level);
      if (level !== null && ![1, 2, 3, 4].includes(level)) return fail(res, 400, 'level must be 1, 2, 3 or 4');

      const inserted = await pool.query(
        `INSERT INTO dictionary_entries
           (hanzi, pinyin, pinyin_plain, meaning, part_of_speech, measure_word, level,
            example_hanzi, example_pinyin, example_meaning, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'admin')
         ON CONFLICT (hanzi, pinyin) DO UPDATE SET
           meaning = EXCLUDED.meaning,
           part_of_speech = EXCLUDED.part_of_speech,
           measure_word = EXCLUDED.measure_word,
           level = EXCLUDED.level,
           example_hanzi = EXCLUDED.example_hanzi,
           example_pinyin = EXCLUDED.example_pinyin,
           example_meaning = EXCLUDED.example_meaning,
           updated_at = NOW()
         RETURNING ${PUBLIC_COLUMNS}`,
        [
          hanzi, pinyin, plainPinyin(pinyin), meaning,
          body.partOfSpeech ? String(body.partOfSpeech).slice(0, 32) : null,
          body.measureWord ? String(body.measureWord).slice(0, 24) : null,
          level,
          body.exampleHanzi ? String(body.exampleHanzi).slice(0, 400) : null,
          body.examplePinyin ? String(body.examplePinyin).slice(0, 400) : null,
          body.exampleMeaning ? String(body.exampleMeaning).slice(0, 400) : null
        ]
      );
      ok(res, { entry: shape(inserted.rows[0]) });
    } catch (error) {
      console.error('dictionary admin create:', error.message);
      if (!res.headersSent) fail(res, 500, 'Could not save that entry');
    }
  });

  router.patch('/admin/dictionary/:id/review', requireAdmin, async (req, res) => {
    try {
      await ensureDictionarySchema();
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid entry id');
      const reviewed = req.body && req.body.reviewed === false ? false : true;
      const updated = await pool.query(
        `UPDATE dictionary_entries
         SET reviewed = $1,
             reviewed_by = CASE WHEN $1 THEN $2 ELSE NULL END,
             reviewed_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
             updated_at = NOW()
         WHERE entry_id = $3
         RETURNING ${PUBLIC_COLUMNS}`,
        [reviewed, req.adminUserId || null, id]
      );
      if (!updated.rows.length) return fail(res, 404, 'Entry not found');
      ok(res, { entry: shape(updated.rows[0]) });
    } catch (error) {
      console.error('dictionary admin review:', error.message);
      if (!res.headersSent) fail(res, 500, 'Could not update that entry');
    }
  });
}
