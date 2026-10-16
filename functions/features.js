/* =========================================================
   HANVERSE FEATURE PACK — DB-backed quests, streaks,
   review deck, tone game, leaderboards, referrals, trial,
   family/class codes, parent digest.
   All schema changes are idempotent (safe to run on boot).
   ========================================================= */
let pool = null;
let schemaReady = false;

export async function ensureFeatureSchema(pgPool) {
  if (schemaReady) return;
  if (!pgPool) throw new Error('No database pool provided');
  pool = pgPool;
  const q = async (sql) => pool.query(sql);

  // --- users: soft currency, premium/trial, family/class links, gamification
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

const todayISO = () => new Date().toISOString().slice(0, 10);

export function registerFeatureRoutes(router, pgPool) {
  pool = pgPool;
  /* =========================================================
     1. DAILY QUESTS  (reuses daily_goals + speaking goal)
  ========================================================= */
  router.get('/quests/daily/:userId', async (req, res) => {
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
          speaking: { done: row.completed_speaking || 0, target: row.target_speaking || 5 },
          chestClaimed: row.chest_claimed === true,
          allDone:
            (row.completed_lessons || 0) >= (row.target_lessons || 1) &&
            (row.earned_xp || 0) >= (row.target_xp || 50) &&
            (row.completed_speaking || 0) >= (row.target_speaking || 5)
        }
      });
    } catch (e) {
      console.error('quests/daily error:', e);
      fail(res, 500, 'Failed to load daily quests');
    }
  });

  router.post('/quests/progress', async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      if (!userId) return fail(res, 400, 'userId required');
      await ensureFeatureSchema();

      const kind = String(req.body.kind || '');            // lessons | xp | speaking
      const amount = Math.max(0, Number(req.body.amount || 0));
      if (!['lessons', 'xp', 'speaking'].includes(kind)) return fail(res, 400, 'kind must be lessons|xp|speaking');

      const today = todayISO();
      const col = kind === 'lessons' ? 'completed_lessons' : kind === 'xp' ? 'earned_xp' : 'completed_speaking';
      const targetCol = kind === 'lessons' ? 'target_lessons' : kind === 'xp' ? 'target_xp' : 'target_speaking';

      await pool.query(
        `INSERT INTO daily_goals (user_id, goal_date, ${kind === 'xp' ? 'target_xp, earned_xp' : `${targetCol}, ${col}`})
         VALUES ($1, $2, ${kind === 'xp' ? '50, $3' : '$3, $3'})
         ON CONFLICT (user_id, goal_date)
         DO UPDATE SET ${col} = daily_goals.${col} + $3`,
        [userId, today, amount]
      );

      const row = (await pool.query(
        `SELECT * FROM daily_goals WHERE user_id = $1 AND goal_date = $2`, [userId, today]
      )).rows[0];

      const allDone =
        (row.completed_lessons || 0) >= (row.target_lessons || 1) &&
        (row.earned_xp || 0) >= (row.target_xp || 50) &&
        (row.completed_speaking || 0) >= (row.target_speaking || 5);

      ok(res, { quest: row, allDone });
    } catch (e) {
      console.error('quests/progress error:', e);
      fail(res, 500, 'Failed to record quest progress');
    }
  });

  // Claim the daily chest: bonus XP + gems once per day when all quests done
  router.post('/quests/claim-chest', async (req, res) => {
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
        (row.earned_xp || 0) >= (row.target_xp || 50) &&
        (row.completed_speaking || 0) >= (row.target_speaking || 5);
      if (!allDone) return fail(res, 400, 'Daily quests not complete yet');
      if (row.chest_claimed) return fail(res, 409, 'Chest already claimed today');

      const bonusXp = 25, bonusGems = 5;
      await pool.query(`UPDATE daily_goals SET chest_claimed = TRUE WHERE user_id = $1 AND goal_date = $2`, [userId, today]);
      await pool.query(`UPDATE users SET xp = xp + $1, gems = gems + $2, updated_at = NOW() WHERE user_id = $3`,
        [bonusXp, bonusGems, userId]);
      await pool.query(
        `INSERT INTO xp_logs (user_id, amount, source) VALUES ($1, $2, 'daily_chest')`, [userId, bonusXp]);
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type)
         VALUES ($1, '🎁 Daily chest opened!', $2, 'reward')`,
        [userId, `All quests complete! +${bonusXp} XP and ${bonusGems} gems.`]);

      ok(res, { bonusXp, bonusGems });
    } catch (e) {
      console.error('quests/claim-chest error:', e);
      fail(res, 500, 'Failed to claim chest');
    }
  });

  /* =========================================================
     2. STREAK + STREAK FREEZE
  ========================================================= */
  router.get('/streak/:userId', async (req, res) => {
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
  router.post('/streak/freeze', async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      const useGem = req.body.payWithGems === true;
      if (!userId) return fail(res, 400, 'userId required');
      await ensureFeatureSchema();

      const u = (await pool.query(
        `SELECT streak_days, last_active, streak_freezes, gems, is_premium FROM users WHERE user_id = $1`, [userId]
      )).rows[0];
      if (!u) return fail(res, 404, 'User not found');

      // Premium members earn a freeze automatically when they run out.
      if (u.streak_freezes <= 0) {
        if (useGem) {
          if ((u.gems || 0) < 10) return fail(res, 402, 'Not enough gems (10 needed)');
          await pool.query(`UPDATE users SET gems = gems - 10 WHERE user_id = $1`, [userId]);
        } else if (u.is_premium) {
          await pool.query(`UPDATE users SET streak_freezes = 1 WHERE user_id = $1`, [userId]);
        } else {
          return fail(res, 402, 'No streak freezes available. Premium members get one monthly, or pay 10 gems.');
        }
      } else {
        await pool.query(`UPDATE users SET streak_freezes = streak_freezes - 1 WHERE user_id = $1 AND streak_freezes > 0`, [userId]);
      }

      // Pretend yesterday was active so the streak logic keeps the fire alive
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const upd = await pool.query(
        `UPDATE users SET last_active = GREATEST(COALESCE(last_active, $2), $2)::date, updated_at = NOW()
         WHERE user_id = $1 RETURNING streak_days, streak_freezes, gems`,
        [userId, yesterday]
      );
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
  router.get('/review/deck/:userId', async (req, res) => {
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

  router.post('/review/answer', async (req, res) => {
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
  router.post('/placement/submit', async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      const correct = Math.max(0, Number(req.body.correct || 0));
      const total = Math.max(1, Number(req.body.total || 1));
      if (!userId) return fail(res, 400, 'userId required');
      await ensureFeatureSchema();

      const pct = correct / total;
      const level = pct >= 0.9 ? 4 : pct >= 0.7 ? 3 : pct >= 0.4 ? 2 : 1;

      await pool.query(
        `INSERT INTO placement_results (user_id, recommended_level, correct, total, answers)
         VALUES ($1,$2,$3,$4,$5)`,
        [userId, level, correct, total, JSON.stringify(req.body.answers || [])]
      );
      ok(res, { recommendedLevel: level,
        message: `We recommend starting at YCT ${level}.` });
    } catch (e) {
      console.error('placement/submit error:', e);
      fail(res, 500, 'Failed to save placement');
    }
  });

  /* =========================================================
     5. TONE-PAIR GAME + GAME SESSIONS
  ========================================================= */
  router.post('/games/session', async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      const game = String(req.body.game || '').slice(0, 40);
      const score = Math.max(0, Number(req.body.score || 0));
      const correct = Math.max(0, Number(req.body.correct || 0));
      const total = Math.max(0, Number(req.body.total || 0));
      if (!userId || !game) return fail(res, 400, 'userId and game required');
      await ensureFeatureSchema();

      await pool.query(
        `INSERT INTO game_sessions (user_id, game, score, correct, total) VALUES ($1,$2,$3,$4,$5)`,
        [userId, game, score, correct, total]
      );
      // XP = score/2, logged for the weekly leaderboard
      const xp = Math.round(score / 2);
      if (xp > 0) {
        await pool.query(`UPDATE users SET xp = xp + $1, updated_at = NOW() WHERE user_id = $2`, [xp, userId]);
        await pool.query(`INSERT INTO xp_logs (user_id, amount, source) VALUES ($1, $2, $3)`, [userId, xp, `game:${game}`]);
      }
      ok(res, { xpEarned: xp });
    } catch (e) {
      console.error('games/session error:', e);
      fail(res, 500, 'Failed to save game session');
    }
  });

  /* =========================================================
     6. WEEKLY LEADERBOARD (opt-in, privacy-aware)
  ========================================================= */
  router.get('/leaderboard/weekly/:userId', async (req, res) => {
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
        `SELECT u.user_id, u.username, u.full_name, u.profile_picture,
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

  router.post('/leaderboard/optin', async (req, res) => {
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
  router.get('/referrals/stats/:userId', async (req, res) => {
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
  router.post('/trial/start', async (req, res) => {
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

  router.get('/trial/status/:userId', async (req, res) => {
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
  router.post('/parents/digest/send', async (req, res) => {
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
        for (const kid of kids) {
          const wk = (await pool.query(
            `SELECT COALESCE(SUM(amount),0)::int AS xp FROM xp_logs WHERE user_id=$1 AND timestamp >= NOW() - INTERVAL '7 days'`,
            [kid.user_id]
          )).rows[0].xp;
          const lessons = (await pool.query(
            `SELECT COUNT(*)::int AS n FROM user_progress WHERE user_id=$1 AND completed=TRUE AND completed_at >= NOW() - INTERVAL '7 days'`,
            [kid.user_id]
          )).rows[0].n;
          rows.push(`<tr>
            <td style="padding:10px 14px;border-bottom:1px solid #D5E3F0;font-weight:700;">${kid.full_name || kid.user_id}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #D5E3F0;">${wk} XP</td>
            <td style="padding:10px 14px;border-bottom:1px solid #D5E3F0;">${lessons} lesson${lessons === 1 ? '' : 's'}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #D5E3F0;">🔥 ${kid.streak_days || 0} day${(kid.streak_days || 0) === 1 ? '' : 's'}</td>
          </tr>`);
        }

        const html = `
        <div style="font-family:Arial,sans-serif;background:#F5F9FF;padding:28px;">
          <div style="max-width:600px;margin:auto;background:#fff;border-radius:20px;overflow:hidden;border:1px solid #D5E3F0;">
            <div style="background:#2563EB;padding:22px 26px;color:#fff;">
              <div style="font-size:22px;font-weight:800;">🐼 HanVerse Weekly Report</div>
              <div style="font-size:12px;opacity:.85;">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
            </div>
            <div style="padding:24px 26px;">
              <p style="color:#1E3A5F;font-size:14px;">Hi ${parent.full_name || 'there'}, here is how your family did this week:</p>
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
     10. VIRTUAL CLASSROOM (minimal: join code + roster)
  ========================================================= */
  router.post('/classroom/join', async (req, res) => {
    try {
      const userId = uid(req.body, 'userId', 'user_id');
      const code = String(req.body.classCode || '').trim().toUpperCase();
      if (!userId || !code) return fail(res, 400, 'userId and classCode required');
      await ensureFeatureSchema();
      const cls = (await pool.query(`SELECT class_id, class_name FROM classrooms WHERE class_code = $1`, [code])).rows[0];
      if (!cls) return fail(res, 404, 'Class code not found');
      await pool.query(`UPDATE users SET class_code = $1 WHERE user_id = $2`, [code, userId]);
      ok(res, { className: cls.class_name });
    } catch (e) {
      console.error('classroom/join error:', e);
      fail(res, 500, 'Failed to join class');
    }
  });

  router.post('/classroom/create', async (req, res) => {
    try {
      const teacherId = uid(req.body, 'teacherId', 'userId');
      const name = String(req.body.className || '').slice(0, 100);
      if (!teacherId || !name) return fail(res, 400, 'teacherId and className required');
      await ensureFeatureSchema();
      const code = 'HV' + crypto.randomBytes(3).toString('hex').toUpperCase();
      await pool.query(`INSERT INTO classrooms (teacher_id, class_code, class_name) VALUES ($1,$2,$3)`, [teacherId, code, name]);
      ok(res, { classCode: code });
    } catch (e) {
      console.error('classroom/create error:', e);
      fail(res, 500, 'Failed to create class');
    }
  });

  router.get('/classroom/roster/:classCode', async (req, res) => {
    try {
      await ensureFeatureSchema();
      const code = String(req.params.classCode || '').toUpperCase();
      const rows = (await pool.query(
        `SELECT user_id, full_name, username, xp, streak_days, is_premium
         FROM users WHERE class_code = $1 ORDER BY xp DESC`, [code]
      )).rows;
      ok(res, { students: rows });
    } catch (e) {
      console.error('classroom/roster error:', e);
      fail(res, 500, 'Failed to load roster');
    }
  });

  /* =========================================================
     11. HANPAN PET STAGE (derived from XP; no table needed)
  ========================================================= */
  router.get('/pet/:userId', async (req, res) => {
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
  router.get('/gems/:userId', async (req, res) => {
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
}
