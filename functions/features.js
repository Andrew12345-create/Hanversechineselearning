/* =========================================================
   HANVERSE FEATURE PACK — DB-backed quests, streaks,
   review deck, tone game, leaderboards, referrals, trial,
   family/class codes, parent digest.
   All schema changes are idempotent (safe to run on boot).
   ========================================================= */
import { upgradeParentDigestEmail } from './parent-digest-ai.js';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';

let pool = null;
let schemaReady = false;

export async function ensureFeatureSchema(pgPool) {
  if (schemaReady) return;
  pgPool = pgPool || pool; // handlers may call with no args — use the pool registered at boot
  if (!pgPool) throw new Error('No database pool provided');
  pool = pgPool;
  const q = async (sql) => pool.query(sql);

  // --- users: soft currency, premium/trial, family/class links, gamification
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'student'`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gems INTEGER DEFAULT 0`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_freezes INTEGER DEFAULT 0`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_used BOOLEAN DEFAULT FALSE`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES users(user_id)`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS class_code VARCHAR(12)`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS share_leaderboard BOOLEAN DEFAULT TRUE`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS freeze_used_on DATE`);
  await q(`CREATE INDEX IF NOT EXISTS idx_users_class_code ON users(class_code)`);

  // --- daily goals: extend with a speaking goal + chest flag
  await q(`ALTER TABLE daily_goals ADD COLUMN IF NOT EXISTS target_speaking INTEGER DEFAULT 5`);
  await q(`ALTER TABLE daily_goals ADD COLUMN IF NOT EXISTS completed_speaking INTEGER DEFAULT 0`);
  await q(`ALTER TABLE daily_goals ADD COLUMN IF NOT EXISTS chest_claimed BOOLEAN DEFAULT FALSE`);
  // HanPan's 5-minute mission (pinned per day: lesson + 3 review words + game)
  await q(`ALTER TABLE daily_goals ADD COLUMN IF NOT EXISTS mission_lesson_id VARCHAR(50)`);
  await q(`ALTER TABLE daily_goals ADD COLUMN IF NOT EXISTS mission_words JSONB`);
  await q(`ALTER TABLE daily_goals ADD COLUMN IF NOT EXISTS mission_claimed BOOLEAN DEFAULT FALSE`);

  // --- spaced repetition review queue
  await q(`CREATE TABLE IF NOT EXISTS review_queue (
    review_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    word VARCHAR(100) NOT NULL,
    pinyin VARCHAR(150),
    meaning VARCHAR(200),
    interval_days INTEGER DEFAULT 1,
    ease REAL DEFAULT 2.3,
    due_at TIMESTAMPTZ DEFAULT NOW(),
    lapses INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, word)
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_review_due ON review_queue(user_id, due_at)`);

  // --- game sessions (tone pairs etc.) + weekly leaderboard source
  await q(`CREATE TABLE IF NOT EXISTS xp_logs (
    log_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    amount INTEGER NOT NULL,
    source VARCHAR(50) DEFAULT 'unknown',
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_xp_logs_ts ON xp_logs(timestamp)`);

  await q(`CREATE TABLE IF NOT EXISTS game_sessions (
    session_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    game VARCHAR(40) NOT NULL,
    score INTEGER DEFAULT 0,
    correct INTEGER DEFAULT 0,
    total INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_game_sessions_game ON game_sessions(game, created_at)`);

  // --- Tone Coach: per tone-pair mastery (adaptive drills + progress view)
  await q(`CREATE TABLE IF NOT EXISTS tone_stats (
    stat_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    tone_pair VARCHAR(16) NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, tone_pair)
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tone_stats_user ON tone_stats(user_id)`);

  await q(`CREATE TABLE IF NOT EXISTS placement_results (
    placement_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    recommended_level INTEGER NOT NULL,
    correct INTEGER DEFAULT 0,
    total INTEGER DEFAULT 0,
    answers JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  // --- referral rewards
  await q(`CREATE TABLE IF NOT EXISTS referral_rewards (
    reward_id SERIAL PRIMARY KEY,
    referrer_id INTEGER NOT NULL REFERENCES users(user_id),
    invited_email VARCHAR(150),
    invited_user_id INTEGER REFERENCES users(user_id),
    status VARCHAR(20) DEFAULT 'pending', -- pending | joined | rewarded
    reward VARCHAR(60),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // --- virtual classroom
  await q(`CREATE TABLE IF NOT EXISTS classrooms (
    class_id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(user_id),
    class_code VARCHAR(12) UNIQUE NOT NULL,
    class_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // --- class quests (teacher-set weekly goal; one active per class)
  await q(`CREATE TABLE IF NOT EXISTS class_quests (
    quest_id SERIAL PRIMARY KEY,
    class_code VARCHAR(12) NOT NULL,
    title VARCHAR(200) NOT NULL,
    target_lesson_id VARCHAR(50),
    target_level INTEGER,
    due_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_class_quests_code ON class_quests(class_code, is_active)`);

  // --- hearts (P1 retention): 5 max, +1 per 30 min, premium = unlimited
  await q(`CREATE TABLE IF NOT EXISTS user_hearts (
    user_id INTEGER PRIMARY KEY REFERENCES users(user_id),
    hearts INTEGER DEFAULT 5,
    last_refill TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`ALTER TABLE user_hearts ADD COLUMN IF NOT EXISTS practice_refill_date DATE`);

  // --- weekly leagues (P1 retention): bronze → diamond cohorts
  await q(`CREATE TABLE IF NOT EXISTS leagues (
    league_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    week_start DATE NOT NULL,
    league VARCHAR(20) NOT NULL DEFAULT 'bronze',
    UNIQUE(user_id, week_start)
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_leagues_week ON leagues(week_start, league)`);

  // --- achievements catalog writes (base table exists; make grants idempotent)
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_unique
           ON achievements(user_id, achievement_type)`);

  // --- TRIAL EXPIRY SWEEP: once per cold instance. Only clears trial
  // premium; Stripe premium lives in the separate `premium`/`premium_until`
  // columns and is unaffected.
  try {
    const sweep = await pool.query(
      `UPDATE users SET is_premium = FALSE, updated_at = NOW()
       WHERE is_premium = TRUE AND trial_used = TRUE
         AND trial_ends_at IS NOT NULL AND trial_ends_at < NOW()`
    );
    if (sweep.rowCount) console.log(`⏰ Trial sweep: expired premium for ${sweep.rowCount} user(s)`);
  } catch (e) {
    console.warn('⚠️ Trial sweep failed (non-fatal):', e.message);
  }

  schemaReady = true;
  console.log('✅ Feature-pack schema ensured');
}

function uid(body, ...names) {
  for (const n of names) {
    const v = body?.[n];
    if (v !== undefined && v !== null && v !== '') return Number(v);
  }
  return null;
}

const ok = (res, json) => res.json({ success: true, ...json });
const fail = (res, code, error) => res.status(code).json({ success: false, error });
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function registerFeatureRoutes(router, pgPool, opts = {}) {
  pool = pgPool;
  // Optional admin guard (server.js passes its verifyAdminToken middleware).
  // Falls back to open access when not provided (local dev).
  const requireAdmin = opts.verifyAdminToken || ((_req, _res, next) => next());

  /* --- AUTH: every user-scoped route must present a valid JWT. ---
     The verified token identity is injected into req.body/req.params so
     handlers always operate on the signed-in user, never a client-claimed id. */
  if (!opts.verifyJWTToken || !opts.requireUser) {
    throw new Error('features.js requires the shared JWT verifier and user authenticator — refusing to mount unauthenticated user routes');
  }
  const requireAuth = (req, res, next) => {
    Promise.resolve(opts.requireUser(req, res)).then(user => {
      if (!user) return;
      const id = Number(user.user_id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 401, 'Session expired — please sign in again');
      req.userId = id;
      req.body = { ...(req.body || {}), userId: id };
      req.params = { ...req.params, userId: String(id) };
      next();
    }).catch(error => {
      console.error('feature auth:', error.message);
      if (!res.headersSent) fail(res, 500, 'Authentication failed');
    });
  };

  // Basic abuse guard on game/quest/classroom writes (per warm instance).
  // Netlify runs behind a proxy: req.ip is often undefined there, so key the
  // limiter on Netlify's real client-IP header with safe fallbacks.
  const clientKey = req => {
    const h = req.headers || {};
    return (req.ip || h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || 'anon').split(',')[0].trim();
  };
  const writeLimiter = rateLimit({
    keyGenerator: clientKey,
    validate: false,
    windowMs: 5 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests — take a short break 🐼' }
  });

  /* =========================================================
     1. DAILY QUESTS  (reuses daily_goals + speaking goal)
  ========================================================= */
  router.get('/quests/daily/:userId', requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!userId) return fail(res, 400, 'userId required');
      await ensureFeatureSchema();

      const today = todayISO();
      const existing = await pool.query(
        `SELECT * FROM daily_goals WHERE user_id = $1 AND goal_date = $2`,
        [userId, today]
      );
      let row = existing.rows[0];
      if (!row) {
        const ins = await pool.query(
          `INSERT INTO daily_goals (user_id, goal_date, target_lessons, target_xp, target_speaking)
           VALUES ($1, $2,
             GREATEST(COALESCE((SELECT target_lessons FROM daily_goals WHERE user_id=$1 ORDER BY goal_date DESC LIMIT 1), 1), 1),
             GREATEST(COALESCE((SELECT target_xp FROM daily_goals WHERE user_id=$1 ORDER BY goal_date DESC LIMIT 1), 50), 50),
             5)
           RETURNING *`,
          [userId, today]
        );
        row = ins.rows[0];
      }
      ok(res, {
        quest: {
          date: row.goal_date,
          lessons: { done: row.completed_lessons || 0, target: row.target_lessons || 1 },
          xp: { done: row.earned_xp || 0, target: row.target_xp || 50 },
          speaking: { done: row.completed_speaking || 0, target: row.target_speaking || 5, optional: true },
          chestClaimed: row.chest_claimed === true,
          allDone:
            (row.completed_lessons || 0) >= (row.target_lessons || 1) &&
            (row.earned_xp || 0) >= (row.target_xp || 50)
        }
      });
    } catch (e) {
      console.error('quests/daily error:', e);
      fail(res, 500, 'Failed to load daily quests');
    }
  });

  router.post('/quests/progress', requireAuth, writeLimiter,async (req, res) => {
    return fail(res, 410, 'Daily progress is recorded by verified lesson and game activity.');
  });

  // Claim the daily chest: bonus XP + gems once per day when all quests done
  router.post('/quests/claim-chest', requireAuth, writeLimiter,async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      if (!userId) return fail(res, 400, 'userId required');
      await ensureFeatureSchema();

      const today = todayISO();
      const row = (await pool.query(
        `SELECT * FROM daily_goals WHERE user_id = $1 AND goal_date = $2`, [userId, today]
      )).rows[0];

      if (!row) return fail(res, 404, 'No quest row for today');
      const allDone =
        (row.completed_lessons || 0) >= (row.target_lessons || 1) &&
        (row.earned_xp || 0) >= (row.target_xp || 50);
      if (!allDone) return fail(res, 400, 'Daily quests not complete yet');
      if (row.chest_claimed) return fail(res, 409, 'Chest already claimed today');

      const bonusXp = 25, bonusGems = 5;
      const reward = await pool.query(
        `WITH claimed AS (
           UPDATE daily_goals SET chest_claimed = TRUE
           WHERE user_id = $1 AND goal_date = $2 AND chest_claimed = FALSE
             AND COALESCE(completed_lessons, 0) >= COALESCE(NULLIF(target_lessons, 0), 1)
             AND COALESCE(earned_xp, 0) >= COALESCE(NULLIF(target_xp, 0), 50)
           RETURNING user_id
         ), paid AS (
           UPDATE users u SET xp = COALESCE(u.xp, 0) + $3, gems = COALESCE(u.gems, 0) + $4, updated_at = NOW()
           FROM claimed c WHERE u.user_id = c.user_id RETURNING u.user_id
         ), logged AS (
           INSERT INTO xp_logs (user_id, amount, source)
           SELECT user_id, $3, 'daily_chest' FROM paid RETURNING user_id
         ), notified AS (
           INSERT INTO notifications (user_id, title, message, type)
           SELECT user_id, '🎁 Daily chest opened!', $5, 'reward' FROM logged RETURNING user_id
         )
         SELECT user_id FROM notified`,
        [userId, today, bonusXp, bonusGems, `All quests complete! +${bonusXp} XP and ${bonusGems} gems.`]
      );
      if (!reward.rowCount) return fail(res, 409, 'Chest already claimed or quests are no longer complete');

      await grant(userId, 'treasure_hunter');
      ok(res, { bonusXp, bonusGems });
    } catch (e) {
      console.error('quests/claim-chest error:', e);
      fail(res, 500, 'Failed to claim chest');
    }
  });

  /* =========================================================
     1b. HANPAN'S 5-MINUTE MISSION
     One pinned lesson step + 3 spaced-repetition review words + one quick
     game round per day. Selection and completion are computed SERVER-SIDE
     (no client-trusted progress): the lesson part is done when the pinned
     lesson was completed today, each review word when its due_at moved into
     the future (review/answer does that), the game part when a game session
     exists today. Claiming grants bonus XP + gems once per day.
  ========================================================= */
  const MISSION_WORDS = 3;

  async function ensureMissionRow(userId, today) {
    let row = (await pool.query(
      `SELECT * FROM daily_goals WHERE user_id = $1 AND goal_date = $2`, [userId, today]
    )).rows[0];
    if (!row) {
      row = (await pool.query(
        `INSERT INTO daily_goals (user_id, goal_date, target_lessons, target_xp, target_speaking)
         VALUES ($1, $2, 1, 50, 5)
         ON CONFLICT (user_id, goal_date) DO UPDATE SET goal_date = $2
         RETURNING *`, [userId, today]
      )).rows[0];
    }
    return row;
  }

  async function computeMission(userId, today, row) {
    // Pin today's lesson + review words once (date-based, resets next day).
    if (!row.mission_lesson_id && !row.mission_claimed) {
      const next = (await pool.query(
        `SELECT l.lesson_id, l.title, l.level
         FROM lessons l
         WHERE l.is_published = TRUE
           AND NOT EXISTS (
             SELECT 1 FROM user_progress up
             WHERE up.user_id = $1 AND up.lesson_id = l.lesson_id AND up.completed = TRUE
           )
         ORDER BY l.level, l.order_index
         LIMIT 1`, [userId]
      )).rows[0];
      const words = (await pool.query(
        `SELECT word, pinyin, meaning FROM review_queue
         WHERE user_id = $1 AND due_at <= NOW() ORDER BY due_at LIMIT $2`,
        [userId, MISSION_WORDS]
      )).rows;
      await pool.query(
        `UPDATE daily_goals SET mission_lesson_id = $1, mission_words = $2 WHERE user_id = $3 AND goal_date = $4`,
        [next ? next.lesson_id : null, JSON.stringify(words.map(w => w.word)), userId, today]
      );
      row.mission_lesson_id = next ? next.lesson_id : null;
      row.mission_words = words.map(w => w.word);
    }

    // Lesson part: done when the pinned lesson is completed (it was the
    // first uncompleted lesson when pinned, so any completion is the kid's).
    let lessonDone = true, lessonInfo = null;
    if (row.mission_lesson_id) {
      const lp = (await pool.query(
        `SELECT l.title, l.level, up.completed
         FROM lessons l
         LEFT JOIN user_progress up
           ON up.user_id = $1 AND up.lesson_id = l.lesson_id
         WHERE l.lesson_id = $2`, [userId, row.mission_lesson_id]
      )).rows[0];
      lessonInfo = lp ? { id: row.mission_lesson_id, title: lp.title, level: lp.level } : null;
      lessonDone = !!(lp && lp.completed === true);
    }

    // Review part: a word is done when its due_at moved into the future.
    const wanted = Array.isArray(row.mission_words) ? row.mission_words : [];
    let reviewDone = 0, reviewWords = [];
    if (wanted.length) {
      const rows = (await pool.query(
        `SELECT word, pinyin, meaning, due_at FROM review_queue
         WHERE user_id = $1 AND word = ANY($2::varchar[])`,
        [userId, wanted]
      )).rows;
      for (const r of rows) {
        const done = r.due_at ? new Date(r.due_at).getTime() > Date.now() : false;
        if (done) reviewDone++;
        reviewWords.push({ word: r.word, pinyin: r.pinyin, meaning: r.meaning, done });
      }
    }

    // Game part: any game session today.
    const gameDone = (await pool.query(
      `SELECT 1 FROM game_sessions WHERE user_id = $1 AND created_at >= $2::date LIMIT 1`,
      [userId, today]
    )).rows.length > 0;

    const allDone = lessonDone && reviewDone >= wanted.length && gameDone;
    return {
      date: today,
      lesson: { done: lessonDone, lesson: lessonInfo },
      review: { words: reviewWords, done: reviewDone, needed: wanted.length },
      game: { done: gameDone },
      allDone,
      claimed: row.mission_claimed === true
    };
  }

  router.get('/mission/daily/:userId', requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!userId) return fail(res, 400, 'userId required');
      if (userId !== req.userId) return fail(res, 403, 'You can only view your own mission');
      await ensureFeatureSchema();
      const today = todayISO();
      const row = await ensureMissionRow(userId, today);
      const mission = await computeMission(userId, today, row);
      ok(res, { mission });
    } catch (e) {
      console.error('mission/daily error:', e);
      fail(res, 500, 'Failed to load mission');
    }
  });

  router.post('/mission/claim', requireAuth, writeLimiter, async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      if (!userId) return fail(res, 400, 'userId required');
      if (userId !== req.userId) return fail(res, 403, 'You can only claim your own mission');
      await ensureFeatureSchema();
      const today = todayISO();
      const row = await ensureMissionRow(userId, today);
      const mission = await computeMission(userId, today, row);
      if (!mission.allDone) return fail(res, 400, 'Finish all three mission steps first 🐼');
      if (mission.claimed) return fail(res, 409, 'Mission reward already claimed today');

      const bonusXp = 20, bonusGems = 3;
      const reward = await pool.query(
        `WITH claimed AS (
           UPDATE daily_goals
           SET mission_claimed = TRUE, earned_xp = COALESCE(earned_xp, 0) + $3
           WHERE user_id = $1 AND goal_date = $2 AND mission_claimed = FALSE
           RETURNING user_id
         ), paid AS (
           UPDATE users u SET xp = COALESCE(u.xp, 0) + $3, gems = COALESCE(u.gems, 0) + $4, updated_at = NOW()
           FROM claimed c WHERE u.user_id = c.user_id RETURNING u.user_id
         ), logged AS (
           INSERT INTO xp_logs (user_id, amount, source)
           SELECT user_id, $3, 'mission' FROM paid RETURNING user_id
         ), notified AS (
           INSERT INTO notifications (user_id, title, message, type)
           SELECT user_id, '🐼 Mission complete!', $5, 'reward' FROM logged RETURNING user_id
         )
         SELECT user_id FROM notified`,
        [userId, today, bonusXp, bonusGems, `HanPan's 5-minute mission done: +${bonusXp} XP and ${bonusGems} gems. 加油!`]
      );
      if (!reward.rowCount) return fail(res, 409, 'Mission reward already claimed today');
      ok(res, { bonusXp, bonusGems });
    } catch (e) {
      console.error('mission/claim error:', e);
      fail(res, 500, 'Failed to claim mission reward');
    }
  });

  /* =========================================================
     2. STREAK + STREAK FREEZE
  ========================================================= */
  router.get('/streak/:userId', requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      const row = (await pool.query(
        `SELECT streak_days, last_active, streak_freezes, is_premium FROM users WHERE user_id = $1`, [userId]
      )).rows[0];
      if (!row) return fail(res, 404, 'User not found');
      ok(res, { streak: row });
    } catch (e) {
      console.error('streak error:', e);
      fail(res, 500, 'Failed to load streak');
    }
  });

  // Consume one streak freeze for a missed day (premium: granted monthly, else buy with gems)
  router.post('/streak/freeze', requireAuth, writeLimiter,async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      const useGem = req.body.payWithGems === true;
      if (!userId) return fail(res, 400, 'userId required');
      await ensureFeatureSchema();

      const today = todayISO();
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const missedDay = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
      const client = await pool.connect();
      let upd;
      try {
        await client.query('BEGIN');
        const u = (await client.query(
          `SELECT streak_days, last_active, streak_freezes, gems, is_premium, freeze_used_on
           FROM users WHERE user_id = $1 FOR UPDATE`, [userId]
        )).rows[0];
        if (!u) {
          await client.query('ROLLBACK');
          return fail(res, 404, 'User not found');
        }
        const lastActiveDate = u.last_active ? new Date(u.last_active).toISOString().slice(0, 10) : null;
        if (Number(u.streak_days) <= 0 || lastActiveDate !== missedDay) {
          await client.query('ROLLBACK');
          return fail(res, 409, 'Your streak does not need a freeze right now.');
        }

        if (Number(u.streak_freezes) > 0) {
          await client.query(
            `UPDATE users SET streak_freezes = streak_freezes - 1 WHERE user_id = $1`, [userId]
          );
        } else if (useGem) {
          const spent = await client.query(
            `UPDATE users SET gems = gems - 10 WHERE user_id = $1 AND COALESCE(gems, 0) >= 10 RETURNING user_id`,
            [userId]
          );
          if (!spent.rowCount) {
            await client.query('ROLLBACK');
            return fail(res, 402, 'Not enough gems (10 needed)');
          }
        } else if (u.is_premium) {
          const freezeMonth = u.freeze_used_on ? String(u.freeze_used_on).slice(0, 7) : null;
          if (freezeMonth === today.slice(0, 7)) {
            await client.query('ROLLBACK');
            return fail(res, 402, 'Your monthly premium streak freeze has already been used.');
          }
          await client.query(
            `UPDATE users SET freeze_used_on = $2 WHERE user_id = $1`, [userId, today]
          );
        } else {
          await client.query('ROLLBACK');
          return fail(res, 402, 'No streak freezes available. Premium members get one monthly, or pay 10 gems.');
        }

        upd = await client.query(
          `UPDATE users SET last_active = $2::date, updated_at = NOW()
           WHERE user_id = $1 RETURNING streak_days, streak_freezes, gems`,
          [userId, yesterday]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type)
         VALUES ($1, '🧊 Streak freeze used', 'Your streak was protected. Keep it going!', 'info')`, [userId]);

      ok(res, { streak: upd.rows[0] });
    } catch (e) {
      console.error('streak/freeze error:', e);
      fail(res, 500, 'Failed to use streak freeze');
    }
  });

  /* =========================================================
     3. SPACED-REVIEW DECK (SM-2 lite over vocabulary_progress)
  ========================================================= */
  /* =========================================================
     3c. PERSONAL VOCABULARY UNIVERSE — everything the learner
     has met, merged from vocabulary_progress (lesson-source
     mastery) and review_queue (spaced-repetition state).
     Self-scoped; review state is joined per word.
  ========================================================= */
  router.get('/vocabulary', requireAuth, async (req, res) => {
    try {
      await ensureFeatureSchema();
      // vocabulary_progress predates this codebase (no CREATE TABLE here);
      // degrade to empty lists rather than 500 if a table is missing.
      const safeRows = async (sql) => {
        try { return (await pool.query(sql, [req.userId])).rows; }
        catch (e) { console.warn(`vocabulary: degraded (${e.message.split('\n')[0]})`); return []; }
      };
      const rows = await safeRows(
        `SELECT vp.word, vp.pinyin, vp.meaning, vp.mastery_level, vp.review_count, vp.last_reviewed,
                rq.interval_days, rq.ease, rq.due_at, rq.lapses
         FROM vocabulary_progress vp
         LEFT JOIN review_queue rq ON rq.user_id = vp.user_id AND rq.word = vp.word
         WHERE vp.user_id = $1
         ORDER BY vp.last_reviewed DESC NULLS LAST
         LIMIT 2000`
      );
      // Words enrolled for review but never mastered through lessons.
      const reviewOnly = await safeRows(
        `SELECT rq.word, rq.pinyin, rq.meaning, rq.interval_days, rq.ease, rq.due_at, rq.lapses
         FROM review_queue rq
         LEFT JOIN vocabulary_progress vp ON vp.user_id = rq.user_id AND vp.word = rq.word
         WHERE rq.user_id = $1 AND vp.word IS NULL
         ORDER BY rq.due_at ASC LIMIT 1000`
      );
      ok(res, {
        words: rows.map(r => ({
          word: r.word, pinyin: r.pinyin, meaning: r.meaning,
          mastery: r.mastery_level ?? 0, reviews: r.review_count ?? 0,
          lastReviewed: r.last_reviewed,
          dueAt: r.due_at, lapses: r.lapses ?? 0,
          inReview: r.due_at != null,
          source: 'lesson'
        })),
        reviewOnly: reviewOnly.map(r => ({
          word: r.word, pinyin: r.pinyin, meaning: r.meaning,
          mastery: 0, reviews: 0, lastReviewed: null,
          dueAt: r.due_at, lapses: r.lapses ?? 0,
          inReview: true, source: 'review'
        }))
      });
    } catch (e) {
      console.error('vocabulary error:', e);
      fail(res, 500, 'Failed to load vocabulary');
    }
  });

  router.get('/review/deck/:userId', requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!userId) return fail(res, 400, 'userId required');
      await ensureFeatureSchema();
      const rows = (await pool.query(
        `SELECT word, pinyin, meaning, interval_days, ease, due_at
         FROM review_queue WHERE user_id = $1 AND due_at <= NOW()
         ORDER BY due_at ASC LIMIT 20`, [userId]
      )).rows;
      ok(res, { cards: rows });
    } catch (e) {
      console.error('review/deck error:', e);
      fail(res, 500, 'Failed to load review deck');
    }
  });

  /* =========================================================
     3b. ENROLL WORDS INTO REVIEW QUEUE (no reschedule)
  ========================================================= */
  router.post('/review/enroll', requireAuth, writeLimiter, async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      const words = Array.isArray(req.body.words) ? req.body.words : [];
      if (!userId) return fail(res, 400, 'userId required');
      if (!words.length) return fail(res, 400, 'words required');
      await ensureFeatureSchema();
      let enrolled = 0;
      for (const w of words.slice(0, 50)) {
        const word = String(w?.word || '').trim();
        if (!word) continue;
        const r = await pool.query(
          `INSERT INTO review_queue (user_id, word, pinyin, meaning, interval_days, ease, due_at, lapses)
           VALUES ($1,$2,$3,$4,1,2.3,NOW(),0)
           ON CONFLICT (user_id, word) DO NOTHING`,
          [userId, word.slice(0, 100), w?.pinyin ? String(w.pinyin).slice(0, 150) : null, w?.meaning ? String(w.meaning).slice(0, 200) : null]
        );
        enrolled += r.rowCount || 0;
      }
      ok(res, { enrolled });
    } catch (e) {
      console.error('review/enroll error:', e);
      fail(res, 500, 'Failed to enroll words');
    }
  });

  /* =========================================================
     3c. DELETE MY ACCOUNT (data-deletion request, self-service)
  ========================================================= */
  router.post('/account/delete', requireAuth, writeLimiter, async (req, res) => {
    const client = await pool.connect();
    let subscriptionToCancel = null;
    let customerId = null;
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      if (!userId) { client.release(); return fail(res, 400, 'userId required'); }
      await ensureFeatureSchema();

      // Read billing identity BEFORE the deletion removes the row.
      try {
        const billing = await client.query(
          `SELECT stripe_customer_id, stripe_subscription_id FROM users WHERE user_id=$1`,
          [userId]
        );
        if (billing.rows[0]) {
          customerId = billing.rows[0].stripe_customer_id || null;
          subscriptionToCancel = billing.rows[0].stripe_subscription_id || null;
        }
      } catch (_) { /* users table may not have stripe columns */ }

      await client.query('BEGIN');
      // Delete rows from every table that has a user_id column (children first via FK discovery)
      const tables = await client.query(`
        SELECT c.table_name, c.data_type FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema='public' AND t.table_name=c.table_name
        WHERE c.table_schema='public' AND c.column_name='user_id' AND t.table_type='BASE TABLE' AND c.table_name <> 'users'
      `);
      for (const t of tables.rows) {
        // Mixed id systems: some tables key by integer users.user_id, others by uuid.
        const isUuid = /uuid/.test(t.data_type);
        const isInt = /int/.test(t.data_type);
        if (isUuid && Number.isInteger(Number(userId))) continue; // different id namespace
        const cast = isInt ? '$1::int' : '$1';
        await client.query(`DELETE FROM "${t.table_name}" WHERE user_id=${cast}`, [userId]);
      }

      // Relationship/attribution FKs that reference users but aren't named user_id
      // (parent links, referrals, invites, classroom teacher, campaign authors...).
      // Pure link rows are deleted; attribution columns are set NULL so shared
      // records (e.g. classrooms, campaigns) survive the deletion.
      const fks = await client.query(`
        SELECT con.conrelid::regclass AS tbl, a.attname AS col
        FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
        WHERE con.confrelid = 'users'::regclass AND con.contype = 'f'
      `);
      const NULL_COLS = new Set(['parent_id','teacher_id','performed_by','verified_by','banned_by','sender_user_id','created_by','authorised_by']);
      for (const fk of fks.rows) {
        const tbl = String(fk.tbl);
        if (NULL_COLS.has(fk.col)) {
          await client.query(`UPDATE "${tbl}" SET "${fk.col}"=NULL WHERE "${fk.col}"=$1`, [userId]);
        } else {
          await client.query(`DELETE FROM "${tbl}" WHERE "${fk.col}"=$1`, [userId]);
        }
      }
      const del = await client.query('DELETE FROM users WHERE user_id=$1', [userId]);
      await client.query('COMMIT');

      // Best-effort: cancel any active Stripe subscription so a deleted
      // account is never billed again. Failure here must not fail the
      // deletion — billing can also be cancelled from the Stripe dashboard.
      if (subscriptionToCancel) {
        try {
          const { default: Stripe } = await import('stripe');
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
          await stripe.subscriptions.cancel(subscriptionToCancel);
          console.log(`✅ Cancelled Stripe subscription ${subscriptionToCancel} for deleted user ${userId}`);
        } catch (stripeErr) {
          console.warn(`⚠️ Could not cancel Stripe subscription ${subscriptionToCancel}:`, stripeErr.message);
        }
      }

      ok(res, { deleted: del.rowCount > 0 });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('account/delete error:', e);
      fail(res, 500, 'Failed to delete account');
    } finally {
      client.release();
    }
  });

  /* =========================================================
     GDPR DATA EXPORT — GET /account/export
     Signed-in users can download everything HanVerse holds
     about them as JSON. Every table is optional: anything that
     does not exist yet exports as an empty list.
  ========================================================= */
  router.get('/account/export', requireAuth, async (req, res) => {
    try {
      await ensureFeatureSchema();
      const uid_ = req.userId;

      const safe = async (sql) => {
        try { return (await pool.query(sql, [uid_])).rows; }
        catch (e) { console.warn(`account/export: skipped a table (${e.message.split('\n')[0]})`); return []; }
      };

      const [profile] = await safe(`SELECT user_id, username, full_name, email, role, age, xp, level, gems, streak_days, premium, premium_until, created_at FROM users WHERE user_id = $1`);
      if (!profile) return fail(res, 404, 'Account not found');

      const export_ = {
        exported_at: new Date().toISOString(),
        profile,
        learning: {
          lessons_completed: await safe(`SELECT lesson_id, course_type, course_level, completed, score, xp_earned, time_spent, attempts, quiz_score, started_at, completed_at FROM user_progress WHERE user_id = $1 ORDER BY COALESCE(completed_at, started_at) DESC`),
          game_sessions: await safe(`SELECT game, score, correct, total, created_at FROM game_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000`),
          daily_goals: await safe(`SELECT * FROM daily_goals WHERE user_id = $1 ORDER BY goal_date DESC LIMIT 400`),
          xp_log: await safe(`SELECT amount, source, timestamp FROM xp_logs WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 1000`),
          vocabulary: await safe(`SELECT word, pinyin, meaning, mastery_level, review_count, last_reviewed FROM vocabulary_progress WHERE user_id = $1`)
        },
        reviews: await safe(`SELECT word, interval_days, ease, due_at, lapses FROM review_queue WHERE user_id = $1`),
        notifications: await safe(`SELECT title, message, type, is_read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`),
        family_links: await safe(`SELECT parent_user_id, child_user_id, child_email, status, created_at, responded_at FROM account_links WHERE parent_user_id = $1 OR child_user_id = $1`)
      };

      res.setHeader('Content-Disposition', `attachment; filename="hanverse-data-export-${uid_}.json"`);
      return res.json(export_);
    } catch (e) {
      console.error('account/export error:', e);
      return fail(res, 500, 'Failed to export data');
    }
  });

  router.post('/review/answer', requireAuth, writeLimiter,async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      const word = String(req.body.word || '');
      const quality = Math.max(0, Math.min(5, Number(req.body.quality || 0))); // 0-5
      const pinyin = req.body.pinyin ? String(req.body.pinyin) : null;
      const meaning = req.body.meaning ? String(req.body.meaning) : null;
      if (!userId || !word) return fail(res, 400, 'userId and word required');
      await ensureFeatureSchema();

      const cur = (await pool.query(
        `SELECT interval_days, ease, lapses FROM review_queue WHERE user_id = $1 AND word = $2`,
        [userId, word]
      )).rows[0];

      let interval, ease, lapses = cur?.lapses || 0;
      if (quality < 3) {
        lapses += 1; interval = 1; ease = Math.max(1.3, (cur?.ease || 2.3) - 0.2);
      } else {
        const prevInterval = cur?.interval_days || 1;
        ease = Math.min(2.8, (cur?.ease || 2.3) + (quality === 5 ? 0.15 : 0.02));
        interval = prevInterval <= 1 ? 2 : Math.round(prevInterval * ease);
        if (quality === 5) interval = Math.max(interval, Math.round(prevInterval * 1.3) + 1);
      }
      const due = new Date(Date.now() + interval * 86400000).toISOString();

      if (cur) {
        await pool.query(
          `UPDATE review_queue SET interval_days=$1, ease=$2, due_at=$3, lapses=$4 WHERE user_id=$5 AND word=$6`,
          [interval, ease, due, lapses, userId, word]
        );
      } else {
        await pool.query(
          `INSERT INTO review_queue (user_id, word, pinyin, meaning, interval_days, ease, due_at, lapses)
           VALUES ($1,$2,$3,$4,$5,2.3,$6,$7)`,
          [userId, word, pinyin, meaning, interval, due, lapses]
        );
      }
      // mirror into vocabulary_progress mastery (0-5)
      await pool.query(
        `INSERT INTO vocabulary_progress (user_id, word, mastery_level, review_count, last_reviewed)
         VALUES ($1,$2,$3,1,NOW())
         ON CONFLICT (vocab_id) DO NOTHING`,
        [userId, word, quality >= 4 ? 4 : quality >= 3 ? 3 : 1]
      ).catch(() => {});

      ok(res, { nextDueInDays: interval });
    } catch (e) {
      console.error('review/answer error:', e);
      fail(res, 500, 'Failed to save answer');
    }
  });

  /* =========================================================
     4. PLACEMENT QUIZ (real answers, stored)
  ========================================================= */
  const placementAnswerKey = [0, 2, 1, 2, 3, 1, 1, 2, 0, 2];
  const gradePlacementAnswers = answers => {
    if (!Array.isArray(answers) || answers.length !== placementAnswerKey.length || answers.some((answer, i) =>
      !answer || !Number.isInteger(answer.question) || answer.question !== i ||
      !Number.isInteger(answer.picked) || answer.picked < 0 || answer.picked > 3
    )) return null;
    const correct = answers.reduce((sum, answer, i) => sum + (answer.picked === placementAnswerKey[i] ? 1 : 0), 0);
    const total = placementAnswerKey.length;
    const pct = correct / total;
    const level = pct >= 0.9 ? 4 : pct >= 0.7 ? 3 : pct >= 0.4 ? 2 : 1;
    return { correct, total, level };
  };

  // Guests can receive a placement result without exposing the answer key in
  // the page source. The shared write limiter protects this public endpoint.
  router.post('/placement/grade', writeLimiter, async (req, res) => {
    const grade = gradePlacementAnswers(req.body?.answers);
    if (!grade) return fail(res, 400, 'Answer all placement questions before calculating your level.');
    ok(res, { correct: grade.correct, total: grade.total, recommendedLevel: grade.level });
  });

  router.post('/placement/submit', requireAuth, writeLimiter,async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      if (!userId) return fail(res, 400, 'userId required');
      // Keep the answer key on the server. Never trust client-supplied score,
      // `correct`, `isCorrect`, or total fields when locking a learner's level.
      const answers = req.body.answers;
      const grade = gradePlacementAnswers(answers);
      if (!grade) {
        return fail(res, 400, 'Answer all placement questions before saving your level.');
      }
      const { correct, total, level } = grade;
      await ensureFeatureSchema();

      await pool.query(
        `INSERT INTO placement_results (user_id, recommended_level, correct, total, answers)
         VALUES ($1,$2,$3,$4,$5)`,
        [userId, level, correct, total, JSON.stringify(req.body.answers || [])]
      );

      // Lock in the placed level server-side. Level changes from here on are
      // gatekept by the end-of-year exam (coming soon) — the client cannot
      // raise or lower it.
      const placed = await pool.query(
        `UPDATE users SET current_yct = $1, level = $2, updated_at = NOW()
         WHERE user_id = $3
         RETURNING current_yct, level`,
        [level, level, userId]
      );

      await grant(userId, 'placed');
      ok(res, { recommendedLevel: level,
        savedLevel: placed.rows[0] ? placed.rows[0].current_yct : level,
        lockedIn: true,
        correct, total,
        message: `You're in! Starting at YCT ${level}.` });
    } catch (e) {
      console.error('placement/submit error:', e);
      fail(res, 500, 'Failed to save placement');
    }
  });

  /* =========================================================
     5. TONE-PAIR GAME + GAME SESSIONS
  ========================================================= */
  /* =========================================================
     TONE COACH — per tone-pair mastery. Powers adaptive drill
     selection and the progress strip. Client reports each
     answered pair; the server clamps counts and scopes rows to
     the signed-in learner.
  ========================================================= */
  router.post('/games/tone-stats', requireAuth, writeLimiter, async (req, res) => {
    try {
      const results = Array.isArray(req.body?.results) ? req.body.results : null;
      if (!results || results.length === 0 || results.length > 100) {
        return fail(res, 400, 'results array required (max 100)');
      }
      const rows = [];
      for (const r of results) {
        const pair = String(r?.pair || '').trim();
        if (!/^[1-5](\s*-\s*[1-5])?$/.test(pair)) return fail(res, 400, 'Invalid tone pair.');
        const seen = Number(r.seen ?? 0), correct = Number(r.correct ?? 0);
        if (!Number.isSafeInteger(seen) || !Number.isSafeInteger(correct) ||
            seen < 1 || correct < 0 || correct > seen) {
          return fail(res, 400, 'Invalid tone counters.');
        }
        rows.push({ pair: pair.replace(/\s+/g, ''), seen, correct });
      }
      await ensureFeatureSchema();
      for (const r of rows) {
        await pool.query(
          `INSERT INTO tone_stats (user_id, tone_pair, seen, correct) VALUES ($1,$2,$3,$4)
           ON CONFLICT (user_id, tone_pair)
           DO UPDATE SET seen = tone_stats.seen + EXCLUDED.seen,
                        correct = tone_stats.correct + EXCLUDED.correct,
                        updated_at = NOW()`,
          [req.userId, r.pair, r.seen, r.correct]
        );
      }
      ok(res, { saved: rows.length });
    } catch (e) {
      console.error('games/tone-stats POST error:', e);
      fail(res, 500, 'Failed to save tone stats');
    }
  });

  router.get('/games/tone-stats', requireAuth, async (req, res) => {
    try {
      await ensureFeatureSchema();
      const rows = await pool.query(
        `SELECT tone_pair AS pair, seen, correct FROM tone_stats WHERE user_id = $1 ORDER BY tone_pair`,
        [req.userId]
      );
      ok(res, { stats: rows.rows });
    } catch (e) {
      console.error('games/tone-stats GET error:', e);
      fail(res, 500, 'Failed to load tone stats');
    }
  });

  router.post('/games/session', requireAuth, writeLimiter,async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      const game = String(req.body.game || '').slice(0, 40);
      const score = Number(req.body.score ?? 0);
      const correct = Number(req.body.correct ?? 0);
      const total = Number(req.body.total ?? 0);
      if (!userId || !game) return fail(res, 400, 'userId and game required');
      if (!['flashcards', 'quiz', 'writing', 'speak_aloud', 'tone_pairs', 'builder'].includes(game) ||
          !Number.isSafeInteger(score) || score < 0 || score > 10000 ||
          !Number.isSafeInteger(correct) || !Number.isSafeInteger(total) ||
          correct < 0 || total < 0 || total > 10000 || correct > total) {
        return fail(res, 400, 'Invalid game result.');
      }
      await ensureFeatureSchema();

      await pool.query(
        `INSERT INTO game_sessions (user_id, game, score, correct, total) VALUES ($1,$2,$3,$4,$5)`,
        [userId, game, score, correct, total]
      );
      // Game scores come from the browser, so cap the daily XP they can mint.
      // Lock the account row so concurrent submissions cannot exceed the cap.
      let xp = 0;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT user_id FROM users WHERE user_id = $1 FOR UPDATE`, [userId]);
        const earned = Number((await client.query(
          `SELECT COALESCE(SUM(amount), 0)::int AS total
           FROM xp_logs WHERE user_id = $1 AND source LIKE 'game:%' AND timestamp >= CURRENT_DATE`,
          [userId]
        )).rows[0]?.total) || 0;
        xp = Math.min(Math.round(score / 2), Math.max(0, 1000 - earned));
        if (xp > 0) {
          await client.query(`UPDATE users SET xp = COALESCE(xp, 0) + $1, updated_at = NOW() WHERE user_id = $2`, [xp, userId]);
          await client.query(`INSERT INTO xp_logs (user_id, amount, source) VALUES ($1, $2, $3)`, [userId, xp, `game:${game}`]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      await grant(userId, 'first_game');
      if (total >= 10 && correct / total >= 0.9) await grant(userId, 'sharp_ear');
      ok(res, { xpEarned: xp });
    } catch (e) {
      console.error('games/session error:', e);
      fail(res, 500, 'Failed to save game session');
    }
  });

  /* =========================================================
     6. WEEKLY LEADERBOARD (opt-in, privacy-aware)
  ========================================================= */
  router.get('/leaderboard/weekly/:userId', requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!userId) return fail(res, 400, 'userId required');
      await ensureFeatureSchema();

      const me = (await pool.query(
        `SELECT share_leaderboard FROM users WHERE user_id = $1`, [userId]
      )).rows[0];
      if (me && me.share_leaderboard === false) {
        return ok(res, { optedOut: true, leaders: [] });
      }

      const rows = (await pool.query(
        `SELECT u.user_id, u.username, u.profile_picture,
                COALESCE(SUM(x.amount), 0) AS week_xp
         FROM users u
         JOIN xp_logs x ON x.user_id = u.user_id AND x.timestamp >= NOW() - INTERVAL '7 days'
         WHERE u.share_leaderboard = TRUE AND u.is_banned = FALSE
         GROUP BY u.user_id
         ORDER BY week_xp DESC
         LIMIT 20`
      )).rows;
      ok(res, { leaders: rows });
    } catch (e) {
      console.error('leaderboard error:', e);
      fail(res, 500, 'Failed to load leaderboard');
    }
  });

  router.post('/leaderboard/optin', requireAuth, writeLimiter,async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      const optIn = req.body.optIn === true;
      if (!userId) return fail(res, 400, 'userId required');
      await ensureFeatureSchema();
      await pool.query(`UPDATE users SET share_leaderboard = $1 WHERE user_id = $2`, [optIn, userId]);
      ok(res, { optIn });
    } catch (e) {
      console.error('leaderboard/optin error:', e);
      fail(res, 500, 'Failed to update preference');
    }
  });

  /* =========================================================
     7. REFERRAL REWARDS
  ========================================================= */
  router.get('/referrals/stats/:userId', requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!userId) return fail(res, 400, 'userId required');
      await ensureFeatureSchema();
      const joined = (await pool.query(
        `SELECT COUNT(*)::int AS n FROM referral_rewards WHERE referrer_id = $1 AND status IN ('joined','rewarded')`,
        [userId]
      )).rows[0].n;
      const rewarded = (await pool.query(
        `SELECT COUNT(*)::int AS n FROM referral_rewards WHERE referrer_id = $1 AND status = 'rewarded'`,
        [userId]
      )).rows[0].n;
      const target = 3;
      ok(res, {
        joined, rewarded, target,
        nextRewardAt: (Math.floor(joined / target) + 1) * target,
        progress: joined % target,
        premiumMonthsEarned: Math.floor(joined / target)
      });
    } catch (e) {
      console.error('referrals/stats error:', e);
      fail(res, 500, 'Failed to load referral stats');
    }
  });

  /* =========================================================
     8. PREMIUM TRIAL
  ========================================================= */
  router.post('/trial/start', requireAuth, writeLimiter,async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      if (!userId) return fail(res, 400, 'userId required');
      await ensureFeatureSchema();
      const u = (await pool.query(`SELECT trial_used, trial_ends_at, is_premium FROM users WHERE user_id = $1`, [userId])).rows[0];
      if (!u) return fail(res, 404, 'User not found');
      if (u.is_premium) return ok(res, { already: 'premium' });
      if (u.trial_used) return ok(res, { already: 'used' });
      const ends = new Date(Date.now() + 7 * 86400000).toISOString();
      await pool.query(`UPDATE users SET trial_used = TRUE, trial_ends_at = $1, is_premium = TRUE WHERE user_id = $2`, [ends, userId]);
      ok(res, { trialEndsAt: ends });
    } catch (e) {
      console.error('trial/start error:', e);
      fail(res, 500, 'Failed to start trial');
    }
  });

  router.get('/trial/status/:userId', requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      const u = (await pool.query(
        `SELECT is_premium, trial_used, trial_ends_at FROM users WHERE user_id = $1`, [userId]
      )).rows[0];
      if (!u) return fail(res, 404, 'User not found');
      const active = u.is_premium && u.trial_ends_at && new Date(u.trial_ends_at) > new Date();
      ok(res, { isPremium: u.is_premium, trialUsed: u.trial_used, trialEndsAt: u.trial_ends_at, trialActive: active });
    } catch (e) {
      console.error('trial/status error:', e);
      fail(res, 500, 'Failed to load trial status');
    }
  });

  /* =========================================================
     9. PARENT WEEKLY DIGEST (admin-triggered)
  ========================================================= */
  router.post('/parents/digest/send', requireAdmin, writeLimiter, async (req, res) => {
    try {
      await ensureFeatureSchema();
      const parentId = uid(req.body, 'parentId', 'parent_id');
      let parents;
      if (parentId) {
        parents = (await pool.query(
          `SELECT user_id, email, full_name FROM users WHERE user_id = $1 AND role = 'parent'`, [parentId]
        )).rows;
        if (!parents.length) return fail(res, 404, 'Parent not found');
      } else {
        parents = (await pool.query(
          `SELECT user_id, email, full_name FROM users WHERE role = 'parent' AND is_banned = FALSE`
        )).rows;
      }

      const { sendEmail } = await import('./email.js').catch(() => ({ sendEmail: null }));
      let sent = 0, skipped = 0;

      for (const parent of parents) {
        const kids = (await pool.query(
          `SELECT user_id, full_name, xp, streak_days FROM users WHERE parent_id = $1`,
          [parent.user_id]
        )).rows;
        if (!kids.length) { skipped++; continue; }

        const rows = [];
        const rowsByKid = new Map();
        for (const kid of kids) {
          const wk = (await pool.query(
            `SELECT COALESCE(SUM(amount),0)::int AS xp FROM xp_logs WHERE user_id=$1 AND timestamp >= NOW() - INTERVAL '7 days'`,
            [kid.user_id]
          )).rows[0].xp;
          const lessons = (await pool.query(
            `SELECT COUNT(*)::int AS n FROM user_progress WHERE user_id=$1 AND completed=TRUE AND completed_at >= NOW() - INTERVAL '7 days'`,
            [kid.user_id]
          )).rows[0].n;
          rowsByKid.set(kid.user_id, { weekXp: wk, lessons: lessons });
          rows.push(`<tr>
            <td style="padding:10px 14px;border-bottom:1px solid #D5E3F0;font-weight:700;">${escapeHtml(kid.full_name || kid.user_id)}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #D5E3F0;">${wk} XP</td>
            <td style="padding:10px 14px;border-bottom:1px solid #D5E3F0;">${lessons} lesson${lessons === 1 ? '' : 's'}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #D5E3F0;">🔥 ${kid.streak_days || 0} day${(kid.streak_days || 0) === 1 ? '' : 's'}</td>
          </tr>`);
        }

                let digestAiPara = '';
        try {
          digestAiPara = await upgradeParentDigestEmail(kids.map(k => {
            const row = rowsByKid.get(k.user_id) || {};
            return { name: k.full_name || ('Learner ' + k.user_id), weeklyXp: row.weekXp || 0, lessons: row.lessons || 0, streakDays: k.streak_days || 0 };
          }));
        } catch (e) { console.warn('digest ai:', e && e.message); }

        const html = `
        <div style="font-family:Arial,sans-serif;background:#F5F9FF;padding:28px;">
          <div style="max-width:600px;margin:auto;background:#fff;border-radius:20px;overflow:hidden;border:1px solid #D5E3F0;">
            <div style="background:#2563EB;padding:22px 26px;color:#fff;">
              <div style="font-size:22px;font-weight:800;">🐼 HanVerse Weekly Report</div>
              <div style="font-size:12px;opacity:.85;">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
            </div>
            <div style="padding:24px 26px;">
              <p style="color:#1E3A5F;font-size:14px;">Hi ${escapeHtml(parent.full_name || 'there')}, ${escapeHtml(digestAiPara || 'here is how your family did this week:').replace(/\r?\n/g, '<br>')}</p>
              <table width="100%" style="border-collapse:collapse;font-size:13px;color:#1E3A5F;">
                <tr style="background:#EFF6FF;color:#2563EB;text-align:left;">
                  <th style="padding:10px 14px;">Child</th><th style="padding:10px 14px;">XP this week</th>
                  <th style="padding:10px 14px;">Lessons</th><th style="padding:10px 14px;">Streak</th>
                </tr>${rows.join('')}
              </table>
              <p style="color:#5D7A9A;font-size:12px;margin-top:18px;">Keep encouraging them — a few minutes of Mandarin every day builds real fluency. 🐼</p>
            </div>
          </div>
        </div>`;

        if (sendEmail) {
          const r = await sendEmail({ to: parent.email, subject: '🐼 Your HanVerse weekly report', html });
          if (r?.success) sent++; else skipped++;
        } else skipped++;
      }
      ok(res, { sent, skipped });
    } catch (e) {
      console.error('parents/digest error:', e);
      fail(res, 500, 'Failed to send digests');
    }
  });

  /* =========================================================
     10. VIRTUAL CLASSROOM (teacher-managed: code join, roster,
        class quest, aggregate progress — privacy-checked)
        Privacy rules: the roster/aggregate/quest endpoints only serve
        the class teacher or a member of that class; students with
        share_leaderboard = FALSE are invisible in every class view.
  ========================================================= */
  const requireTeacher = async (req, res) => {
    const u = (await pool.query(`SELECT role FROM users WHERE user_id = $1`, [req.userId])).rows[0];
    if (!u) return fail(res, 404, 'Account not found');
    if (u.role !== 'teacher' && u.role !== 'admin') {
      return fail(res, 403, 'A teacher account is required for this action');
    }
    return null; // allowed
  };
  const loadClassForViewer = async (req, res) => {
    const code = String(req.params.classCode || req.body.classCode || '').trim().toUpperCase();
    const cls = (await pool.query(
      `SELECT class_id, class_name, class_code, teacher_id FROM classrooms WHERE class_code = $1`, [code]
    )).rows[0];
    if (!cls) { fail(res, 404, 'Class not found'); return { denied: true }; }
    const me = (await pool.query(`SELECT class_code, role FROM users WHERE user_id = $1`, [req.userId])).rows[0];
    if (cls.teacher_id !== req.userId && !(me && me.class_code === cls.class_code)) {
      fail(res, 403, 'You are not in this class');
      return { denied: true };
    }
    return { denied: false, cls, code, isTeacher: cls.teacher_id === req.userId };
  };

  router.post('/classroom/create', requireAuth, writeLimiter, async (req, res) => {
    try {
      const gate = await requireTeacher(req, res);
      if (gate) return gate;
      const name = String(req.body.className || '').trim().slice(0, 100);
      if (!name) return fail(res, 400, 'className required');
      await ensureFeatureSchema();
      const mine = (await pool.query(
        `SELECT COUNT(*)::int AS n FROM classrooms WHERE teacher_id = $1`, [req.userId]
      )).rows[0];
      if (mine.n >= 10) return fail(res, 400, 'You already have 10 classes');
      let code = '';
      for (let i = 0; i < 5; i++) {
        const c = 'HV' + crypto.randomBytes(5).toString('hex').toUpperCase(); // 12 chars
        const dupe = await pool.query(`SELECT 1 FROM classrooms WHERE class_code = $1`, [c]);
        if (!dupe.rows.length) { code = c; break; }
      }
      if (!code) return fail(res, 500, 'Could not allocate a class code — please try again');
      await pool.query(
        `INSERT INTO classrooms (teacher_id, class_code, class_name) VALUES ($1,$2,$3)`,
        [req.userId, code, name]
      );
      ok(res, { classCode: code, className: name });
    } catch (e) {
      console.error('classroom/create error:', e);
      fail(res, 500, 'Failed to create class');
    }
  });

  router.post('/classroom/join', requireAuth, writeLimiter, async (req, res) => {
    try {
      const userId = req.userId; // always the signed-in user — never client-claimed
      const code = String(req.body.classCode || '').trim().toUpperCase();
      if (!code) return fail(res, 400, 'classCode required');
      await ensureFeatureSchema();
      const cls = (await pool.query(`SELECT class_id, class_name FROM classrooms WHERE class_code = $1`, [code])).rows[0];
      if (!cls) return fail(res, 404, 'Class code not found');
      await pool.query(`UPDATE users SET class_code = $1, updated_at = NOW() WHERE user_id = $2`, [code, userId]);
      ok(res, { className: cls.class_name });
    } catch (e) {
      console.error('classroom/join error:', e);
      fail(res, 500, 'Failed to join class');
    }
  });

  router.post('/classroom/leave', requireAuth, writeLimiter, async (req, res) => {
    try {
      await ensureFeatureSchema();
      await pool.query(`UPDATE users SET class_code = NULL, updated_at = NOW() WHERE user_id = $1`, [req.userId]);
      ok(res, {});
    } catch (e) {
      console.error('classroom/leave error:', e);
      fail(res, 500, 'Failed to leave class');
    }
  });

  router.post('/classroom/remove-member', requireAuth, writeLimiter, async (req, res) => {
    try {
      const gate = await requireTeacher(req, res);
      if (gate) return gate;
      const code = String(req.body.classCode || '').trim().toUpperCase();
      const targetId = Number(req.body.targetUserId);
      if (!code || !targetId) return fail(res, 400, 'classCode and targetUserId required');
      await ensureFeatureSchema();
      const owns = (await pool.query(
        `SELECT 1 FROM classrooms WHERE class_code = $1 AND teacher_id = $2`, [code, req.userId]
      )).rows[0];
      if (!owns) return fail(res, 403, 'Not your class');
      if (targetId === req.userId) return fail(res, 400, 'Teachers leave via class settings, not member removal');
      await pool.query(
        `UPDATE users SET class_code = NULL, updated_at = NOW() WHERE user_id = $1 AND class_code = $2`,
        [targetId, code]
      );
      ok(res, {});
    } catch (e) {
      console.error('classroom/remove-member error:', e);
      fail(res, 500, 'Failed to remove member');
    }
  });

  router.get('/classroom/roster/:classCode', requireAuth, async (req, res) => {
    try {
      await ensureFeatureSchema();
      const v = await loadClassForViewer(req, res);
      if (v.denied) return;
      const rows = (await pool.query(
        `SELECT user_id, full_name, username, xp, streak_days, is_premium
         FROM users
         WHERE class_code = $1 AND share_leaderboard IS NOT FALSE
         ORDER BY xp DESC`, [v.code]
      )).rows;
      ok(res, { className: v.cls.class_name, isTeacher: v.isTeacher, students: rows });
    } catch (e) {
      console.error('classroom/roster error:', e);
      fail(res, 500, 'Failed to load roster');
    }
  });

  // Class aggregate progress — totals only, never individual sensitive data.
  router.get('/classroom/aggregate/:classCode', requireAuth, async (req, res) => {
    try {
      await ensureFeatureSchema();
      const v = await loadClassForViewer(req, res);
      if (v.denied) return;
      const agg = (await pool.query(
        `SELECT
           COUNT(*)::int AS members,
           COALESCE(SUM(u.xp), 0)::int AS total_xp,
           COALESCE(SUM(u.streak_days), 0)::int AS streak_days,
           COUNT(*) FILTER (WHERE u.last_active = CURRENT_DATE)::int AS active_today
         FROM users u
         WHERE u.class_code = $1 AND u.share_leaderboard IS NOT FALSE`, [v.code]
      )).rows[0];
      const lessons = (await pool.query(
        `SELECT COUNT(DISTINCT (up.user_id, up.lesson_id))::int AS lessons_completed
         FROM user_progress up
         JOIN users u ON u.user_id = up.user_id
         WHERE u.class_code = $1
           AND u.share_leaderboard IS NOT FALSE
           AND up.completed = TRUE`, [v.code]
      )).rows[0];
      ok(res, { aggregate: { ...agg, lessons_completed: lessons.lessons_completed } });
    } catch (e) {
      console.error('classroom/aggregate error:', e);
      fail(res, 500, 'Failed to load class progress');
    }
  });

  // Teacher sets the ONE active class quest ("Everyone finish YCT 1 Lesson 3
  // this week"). Creating a new quest deactivates the previous one.
  router.post('/classroom/quest', requireAuth, writeLimiter, async (req, res) => {
    try {
      const gate = await requireTeacher(req, res);
      if (gate) return gate;
      const code = String(req.body.classCode || '').trim().toUpperCase();
      const title = String(req.body.title || '').trim().slice(0, 200);
      const targetLessonId = req.body.targetLessonId ? String(req.body.targetLessonId).slice(0, 50) : null;
      const targetLevel = Number(req.body.targetLevel) || null;
      let dueDate = null;
      if (req.body.dueDate) {
        const d = new Date(String(req.body.dueDate) + 'T23:59:59Z');
        if (isNaN(d.getTime())) return fail(res, 400, 'Invalid dueDate');
        dueDate = d.toISOString().slice(0, 10);
      }
      if (!code || !title) return fail(res, 400, 'classCode and title required');
      await ensureFeatureSchema();
      const owns = (await pool.query(
        `SELECT 1 FROM classrooms WHERE class_code = $1 AND teacher_id = $2`, [code, req.userId]
      )).rows[0];
      if (!owns) return fail(res, 403, 'Not your class');
      if (targetLessonId) {
        const lesson = (await pool.query(
          `SELECT title, level FROM lessons WHERE lesson_id = $1 AND is_published = TRUE`, [targetLessonId]
        )).rows[0];
        if (!lesson) return fail(res, 400, 'Unknown lesson for the quest target');
      }
      await pool.query(
        `UPDATE class_quests SET is_active = FALSE WHERE class_code = $1 AND is_active = TRUE`, [code]
      );
      const ins = await pool.query(
        `INSERT INTO class_quests (class_code, title, target_lesson_id, target_level, due_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING quest_id, class_code, title, target_lesson_id, target_level, due_date, is_active, created_at`,
        [code, title, targetLessonId, targetLevel, dueDate, req.userId]
      );
      ok(res, { quest: ins.rows[0] });
    } catch (e) {
      console.error('classroom/quest error:', e);
      fail(res, 500, 'Failed to set class quest');
    }
  });

  // Active quest + live progress bar numbers for the class (member/teacher).
  router.get('/classroom/quest-progress/:classCode', requireAuth, async (req, res) => {
    try {
      await ensureFeatureSchema();
      const v = await loadClassForViewer(req, res);
      if (v.denied) return;
      const quest = (await pool.query(
        `SELECT quest_id, title, target_lesson_id, target_level, due_date, created_at
         FROM class_quests
         WHERE class_code = $1 AND is_active = TRUE
         ORDER BY created_at DESC LIMIT 1`, [v.code]
      )).rows[0] || null;
      if (!quest) return ok(res, { quest: null, progress: null });
      const members = (await pool.query(
        `SELECT COUNT(*)::int AS n FROM users
         WHERE class_code = $1 AND share_leaderboard IS NOT FALSE`, [v.code]
      )).rows[0].n;
      let done = 0;
      let lessonTitle = null;
      if (quest.target_lesson_id) {
        const l = (await pool.query(
          `SELECT title FROM lessons WHERE lesson_id = $1`, [quest.target_lesson_id]
        )).rows[0];
        lessonTitle = l ? l.title : null;
        done = (await pool.query(
          `SELECT COUNT(DISTINCT up.user_id)::int AS n
           FROM user_progress up
           JOIN users u ON u.user_id = up.user_id
           WHERE u.class_code = $1
             AND u.share_leaderboard IS NOT FALSE
             AND up.lesson_id = $2
             AND up.completed = TRUE
             AND GREATEST(up.completed_at, up.updated_at) >= $3`,
          [v.code, quest.target_lesson_id, quest.created_at]
        )).rows[0].n;
      }
      ok(res, { quest: { ...quest, lessonTitle }, progress: { members, done } });
    } catch (e) {
      console.error('classroom/quest-progress error:', e);
      fail(res, 500, 'Failed to load quest progress');
    }
  });

  // Overview for class.html: teacher sees own classes + counts; student sees
  // their class, teacher name and active quest.
  router.get('/classroom/mine', requireAuth, async (req, res) => {
    try {
      await ensureFeatureSchema();
      const me = (await pool.query(
        `SELECT class_code, role FROM users WHERE user_id = $1`, [req.userId]
      )).rows[0];
      if (!me) return fail(res, 404, 'Account not found');

      if (me.role === 'teacher' || me.role === 'admin') {
        const classes = (await pool.query(
          `SELECT c.class_id, c.class_code, c.class_name, c.created_at,
             (SELECT COUNT(*)::int FROM users u
              WHERE u.class_code = c.class_code AND u.share_leaderboard IS NOT FALSE) AS member_count,
             (SELECT q.title FROM class_quests q
              WHERE q.class_code = c.class_code AND q.is_active = TRUE
              ORDER BY q.created_at DESC LIMIT 1) AS quest_title
           FROM classrooms c
           WHERE c.teacher_id = $1
           ORDER BY c.created_at DESC`, [req.userId]
        )).rows;
        return ok(res, { role: me.role, classes });
      }

      if (!me.class_code) return ok(res, { role: 'student', class: null });
      const cls = (await pool.query(
        `SELECT c.class_code, c.class_name, u.full_name AS teacher_name
         FROM classrooms c JOIN users u ON u.user_id = c.teacher_id
         WHERE c.class_code = $1`, [me.class_code]
      )).rows[0];
      if (!cls) return ok(res, { role: 'student', class: null });
      const quest = (await pool.query(
        `SELECT quest_id, title, target_lesson_id, target_level, due_date, created_at
         FROM class_quests
         WHERE class_code = $1 AND is_active = TRUE
         ORDER BY created_at DESC LIMIT 1`, [me.class_code]
      )).rows[0] || null;
      ok(res, { role: 'student', class: cls, quest });
    } catch (e) {
      console.error('classroom/mine error:', e);
      fail(res, 500, 'Failed to load your classroom');
    }
  });

  /* =========================================================
     11. HANPAN PET STAGE (derived from XP; no table needed)
  ========================================================= */
  router.get('/pet/:userId', requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      const u = (await pool.query(`SELECT xp FROM users WHERE user_id = $1`, [userId])).rows[0];
      if (!u) return fail(res, 404, 'User not found');
      const xp = u.xp || 0;
      const stages = [
        { at: 0, stage: 1, name: 'Cub', emoji: '🐼' },
        { at: 500, stage: 2, name: 'Explorer', emoji: '🐼✨' },
        { at: 2000, stage: 3, name: 'Scholar', emoji: '🐼🎓' },
        { at: 5000, stage: 4, name: 'Guardian', emoji: '🐼🛡️' },
        { at: 12000, stage: 5, name: 'Legend', emoji: '🐼🌟' }
      ];
      const current = [...stages].reverse().find(s => xp >= s.at);
      const next = stages.find(s => s.at > xp) || null;
      ok(res, {
        stage: current.stage, name: current.name, emoji: current.emoji, xp,
        next: next ? { at: next.at, name: next.name, xpNeeded: next.at - xp } : null
      });
    } catch (e) {
      console.error('pet error:', e);
      fail(res, 500, 'Failed to load pet');
    }
  });

  /* =========================================================
     12. GEMS BALANCE
  ========================================================= */
  router.get('/gems/:userId', requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      const u = (await pool.query(`SELECT gems FROM users WHERE user_id = $1`, [userId])).rows[0];
      if (!u) return fail(res, 404, 'User not found');
      ok(res, { gems: u.gems || 0 });
    } catch (e) {
      console.error('gems error:', e);
      fail(res, 500, 'Failed to load gems');
    }
  });

  /* =========================================================
     13. HEARTS  (5 max · +1 per 30 min · mistakes cost hearts ·
         premium unlimited · refill with gems or mistake practice)
  ========================================================= */
  const HEART_MAX = 5;
  const HEART_REFILL_MS = 30 * 60 * 1000; // 30 minutes per heart
  const HEART_REFILL_GEM_COST = 100;

  async function heartState(userId) {
    const u = (await pool.query(
      `SELECT is_premium, premium FROM users WHERE user_id = $1`, [userId]
    )).rows[0];
    if (!u) return null;
    const unlimited = !!(u.is_premium || u.premium);
    let row = (await pool.query(
      `SELECT hearts, last_refill FROM user_hearts WHERE user_id = $1`, [userId]
    )).rows[0];
    if (!row) {
      row = (await pool.query(
        `INSERT INTO user_hearts (user_id, hearts, last_refill) VALUES ($1,$2,NOW()) RETURNING hearts, last_refill`,
        [userId, HEART_MAX]
      )).rows[0];
    }
    let { hearts, last_refill } = row;
    hearts = Number(hearts) || 0;
    let last = new Date(last_refill).getTime();
    if (!unlimited && hearts < HEART_MAX) {
      // bank the elapsed refills
      const elapsed = Date.now() - last;
      const gained = Math.floor(elapsed / HEART_REFILL_MS);
      if (gained > 0) {
        hearts = Math.min(HEART_MAX, hearts + gained);
        const carried = elapsed % HEART_REFILL_MS;
        last = hearts >= HEART_MAX ? Date.now() : Date.now() - carried;
        await pool.query(
          `UPDATE user_hearts SET hearts=$1, last_refill=$2, updated_at=NOW() WHERE user_id=$3`,
          [hearts, new Date(last), userId]
        );
      }
    }
    const nextRefillAt = hearts >= HEART_MAX ? null : last + HEART_REFILL_MS;
    return { unlimited, hearts, nextRefillAt };
  }

  router.get('/hearts/:userId', requireAuth, async (req, res) => {
    try {
      const s = await heartState(req.userId);
      if (!s) return fail(res, 404, 'User not found');
      ok(res, {
        hearts: s.unlimited ? HEART_MAX : s.hearts,
        max: HEART_MAX,
        unlimited: s.unlimited,
        nextRefillAt: s.nextRefillAt,
        refillGemCost: HEART_REFILL_GEM_COST
      });
    } catch (e) {
      console.error('hearts error:', e);
      fail(res, 500, 'Failed to load hearts');
    }
  });

  // Lose one heart (a wrong answer). 402 when already empty → client shows refill modal.
  router.post('/hearts/lose', requireAuth, writeLimiter, async (req, res) => {
    try {
      const s = await heartState(req.userId);
      if (!s) return fail(res, 404, 'User not found');
      if (s.unlimited) return ok(res, { unlimited: true, hearts: HEART_MAX });
      if (s.hearts <= 0) return fail(res, 402, 'Out of hearts — refill to keep playing');
      const updated = (await pool.query(
        `UPDATE user_hearts SET hearts = hearts - 1, updated_at = NOW()
         WHERE user_id = $1 AND hearts > 0 RETURNING hearts`,
        [req.userId]
      )).rows[0];
      if (!updated) return fail(res, 402, 'Out of hearts — refill to keep playing');
      ok(res, { unlimited: false, hearts: updated.hearts, max: HEART_MAX, refillGemCost: HEART_REFILL_GEM_COST });
    } catch (e) {
      console.error('hearts/lose error:', e);
      fail(res, 500, 'Failed to update hearts');
    }
  });

  // Refill: pay gems for a full bar, or grant +1 after a mistake-practice session.
  router.post('/hearts/refill', requireAuth, writeLimiter, async (req, res) => {
    try {
      const mode = String(req.body.mode || 'gems');
      const s = await heartState(req.userId);
      if (!s) return fail(res, 404, 'User not found');
      if (s.unlimited) return ok(res, { unlimited: true, hearts: HEART_MAX });

      if (mode === 'gems') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const heartRow = (await client.query(
            `SELECT hearts FROM user_hearts WHERE user_id = $1 FOR UPDATE`, [req.userId]
          )).rows[0];
          if (!heartRow || Number(heartRow.hearts) >= HEART_MAX) {
            await client.query('COMMIT');
            return ok(res, { hearts: HEART_MAX, max: HEART_MAX, gemsSpent: 0 });
          }
          const spent = await client.query(
            `UPDATE users SET gems = gems - $1, updated_at = NOW()
             WHERE user_id = $2 AND COALESCE(gems, 0) >= $1 RETURNING gems`,
            [HEART_REFILL_GEM_COST, req.userId]
          );
          if (!spent.rowCount) {
            await client.query('ROLLBACK');
            return fail(res, 402, `Not enough gems (${HEART_REFILL_GEM_COST} needed)`);
          }
          await client.query(
            `UPDATE user_hearts SET hearts = $1, last_refill = NOW(), updated_at = NOW() WHERE user_id = $2`,
            [HEART_MAX, req.userId]
          );
          await client.query('COMMIT');
          return ok(res, { hearts: HEART_MAX, max: HEART_MAX, gemsSpent: HEART_REFILL_GEM_COST });
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      }

      if (mode === 'practice') {
        if (s.hearts >= HEART_MAX) return ok(res, { hearts: s.hearts, max: HEART_MAX });
        const updated = (await pool.query(
          `UPDATE user_hearts
           SET hearts = LEAST($1, hearts + 1), practice_refill_date = CURRENT_DATE, updated_at = NOW()
           WHERE user_id = $2 AND hearts < $1
             AND (practice_refill_date IS NULL OR practice_refill_date < CURRENT_DATE)
           RETURNING hearts`,
          [HEART_MAX, req.userId]
        )).rows[0];
        if (!updated) return ok(res, { hearts: s.hearts, max: HEART_MAX, granted: 0, alreadyUsed: true });
        return ok(res, { hearts: updated.hearts, max: HEART_MAX, granted: 1 });
      }

      return fail(res, 400, 'Unknown refill mode');
    } catch (e) {
      console.error('hearts/refill error:', e);
      fail(res, 500, 'Failed to refill hearts');
    }
  });

  /* =========================================================
     14. WEEKLY LEAGUES  (bronze → silver → gold → sapphire → diamond)
         ~30-user cohorts, top 5 promote, bottom 5 demote, weekly.
  ========================================================= */
  const LEAGUE_TIERS = ['bronze', 'silver', 'gold', 'sapphire', 'diamond'];
  const LEAGUE_META = {
    bronze:   { name: 'Bamboo League',   emoji: '🎋', min: 0, max: 1 },
    silver:   { name: 'Bronze League',   emoji: '🥉', min: 1, max: 2 },
    gold:     { name: 'Silver League',   emoji: '🥈', min: 2, max: 3 },
    sapphire: { name: 'Gold League',     emoji: '🥇', min: 3, max: 4 },
    diamond:  { name: 'Diamond League',  emoji: '💎', min: 4, max: 4 }
  };
  const weekStartOf = (d = new Date()) => {
    // Monday 00:00 UTC
    const day = d.getUTCDay();
    const diff = (day + 6) % 7;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff))
      .toISOString().slice(0, 10);
  };

  router.get('/leaderboard/league/:userId', requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      const weekStart = weekStartOf();

      // current-week row, seeded from last week's tier (or bronze)
      const existing = (await pool.query(
        `SELECT league FROM leagues WHERE user_id = $1 AND week_start = $2`, [userId, weekStart]
      )).rows[0];
      if (!existing) {
        const prev = (await pool.query(
          `SELECT league FROM leagues WHERE user_id = $1 AND week_start < $2 ORDER BY week_start DESC LIMIT 1`,
          [userId, weekStart]
        )).rows[0];
        await pool.query(
          `INSERT INTO leagues (user_id, week_start, league) VALUES ($1,$2,$3)
           ON CONFLICT (user_id, week_start) DO NOTHING`,
          [userId, weekStart, prev ? prev.league : 'bronze']
        );
      }
      const myLeague = (existing || (await pool.query(
        `SELECT league FROM leagues WHERE user_id = $1 AND week_start = $2`, [userId, weekStart]
      ))).rows[0].league;

      // cohort standings for this week (xp banked since Monday)
      const rows = (await pool.query(
        `SELECT u.user_id, u.full_name, u.username, u.is_premium,
                COALESCE(SUM(x.amount), 0) AS weekly_xp
         FROM leagues l
         JOIN users u ON u.user_id = l.user_id
         LEFT JOIN xp_logs x ON x.user_id = u.user_id AND x.timestamp >= $1::date
         WHERE l.week_start = $1::date AND l.league = $2 AND u.share_leaderboard = TRUE
         GROUP BY u.user_id, u.full_name, u.username, u.is_premium
         ORDER BY weekly_xp DESC, u.user_id ASC
         LIMIT 30`,
        [weekStart, myLeague]
      )).rows;

      const leaders = rows.map((r, i) => ({
        rank: i + 1,
        userId: r.user_id,
        name: r.full_name || r.username || 'Panda',
        weeklyXp: Number(r.weekly_xp) || 0,
        isMe: r.user_id === userId
      }));
      const my = leaders.find(l => l.isMe);
      ok(res, {
        weekStart,
        league: myLeague,
        meta: LEAGUE_META[myLeague],
        me: my || { rank: leaders.length + 1, weeklyXp: 0 },
        promoteCut: 5,
        demoteCut: Math.max(0, leaders.length - 5),
        leaders,
        nextRotation: weekStartOf(new Date(Date.now() + 7 * 86400000))
      });
    } catch (e) {
      console.error('league error:', e);
      fail(res, 500, 'Failed to load league');
    }
  });

  /* =========================================================
     15. MISTAKES HUB  (weakest words first — lapses & low ease)
  ========================================================= */
  router.get('/review/mistakes/:userId', requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      const rows = (await pool.query(
        `SELECT word, pinyin, meaning, lapses, ease, due_at
         FROM review_queue WHERE user_id = $1
         ORDER BY lapses DESC, ease ASC, due_at ASC
         LIMIT 20`, [userId]
      )).rows;
      ok(res, { mistakes: rows, count: rows.length });
    } catch (e) {
      console.error('review/mistakes error:', e);
      fail(res, 500, 'Failed to load mistakes');
    }
  });

  /* =========================================================
     16. ACHIEVEMENTS  (writes to the existing base table)
  ========================================================= */
  const ACHIEVEMENTS = [
    { type: 'first_game',     name: 'First Steps 🎮',    desc: 'Finish your first practice game' },
    { type: 'sharp_ear',      name: 'Sharp Ear 👂',      desc: 'Score 90%+ in a listening game' },
    { type: 'week_warrior',   name: 'Week Warrior 🔥',   desc: 'Keep a 7-day streak' },
    { type: 'month_master',   name: 'Month Master 🗓️',  desc: 'Keep a 30-day streak' },
    { type: 'treasure_hunter',name: 'Treasure Hunter 🧰',desc: 'Claim your first quest chest' },
    { type: 'word_collector', name: 'Word Collector 📚', desc: 'Add 25 words to your review deck' },
    { type: 'placed',         name: 'Level Placed 🎯',   desc: 'Complete the placement quiz' }
  ];

  async function grant(userId, type) {
    try {
      const def = ACHIEVEMENTS.find(a => a.type === type);
      if (!def) return;
      await pool.query(
        `INSERT INTO achievements (user_id, achievement_type, achievement_name)
         SELECT $1, $2, $3 WHERE NOT EXISTS (
           SELECT 1 FROM achievements WHERE user_id = $1 AND achievement_type = $2)`,
        [userId, type, def.name]
      );
    } catch (e) {
      console.warn('achievement grant failed (non-fatal):', e.message);
    }
  }

  router.get('/achievements/:userId', requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      const earned = (await pool.query(
        `SELECT achievement_type, achievement_name, earned_at FROM achievements WHERE user_id = $1`,
        [userId]
      )).rows;
      const earnedSet = new Set(earned.map(a => a.achievement_type));
      ok(res, {
        catalog: ACHIEVEMENTS.map(a => ({ ...a, earned: earnedSet.has(a.type) })),
        earned: earned.map(a => ({ type: a.achievement_type, name: a.achievement_name, at: a.earned_at }))
      });
    } catch (e) {
      console.error('achievements error:', e);
      fail(res, 500, 'Failed to load achievements');
    }
  });

  // Achievement hooks — non-blocking checks on existing flows
  router.post('/achievements/check/:userId', requireAuth, writeLimiter, async (req, res) => {
    try {
      const userId = req.userId;
      const u = (await pool.query(
        `SELECT streak_days FROM users WHERE user_id = $1`, [userId]
      )).rows[0];
      if (u) {
        if ((u.streak_days || 0) >= 7) await grant(userId, 'week_warrior');
        if ((u.streak_days || 0) >= 30) await grant(userId, 'month_master');
      }
      const words = (await pool.query(
        `SELECT COUNT(*) AS c FROM review_queue WHERE user_id = $1`, [userId]
      )).rows[0];
      if (Number(words.c) >= 25) await grant(userId, 'word_collector');
      const earned = (await pool.query(
        `SELECT achievement_type, achievement_name FROM achievements WHERE user_id = $1`,
        [userId]
      )).rows;
      ok(res, { earned });
    } catch (e) {
      console.error('achievements/check error:', e);
      fail(res, 500, 'Failed to check achievements');
    }
  });

  /* =========================================================
     17. DAILY GOAL TARGET  (onboarding: pick 20 / 50 / 100 / 200 XP)
  ========================================================= */
  router.post('/goals/target', requireAuth, writeLimiter, async (req, res) => {
    try {
      const targetXp = Number(req.body.targetXp);
      if (![20, 50, 100, 200].includes(targetXp)) return fail(res, 400, 'targetXp must be 20, 50, 100 or 200');
      const today = todayISO();
      await pool.query(
        `INSERT INTO daily_goals (user_id, goal_date, target_xp)
         VALUES ($1,$2,$3)
         ON CONFLICT (user_id, goal_date) DO UPDATE SET target_xp = $3`,
        [req.userId, today, targetXp]
      );
      ok(res, { targetXp });
    } catch (e) {
      console.error('goals/target error:', e);
      fail(res, 500, 'Failed to set daily goal');
    }
  });
}
