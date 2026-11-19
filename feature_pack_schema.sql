-- =========================================================
-- HANVERSE FEATURE PACK SCHEMA (optional manual run)
-- Mirrors ensureFeatureSchema() in functions/features.js.
-- Normally you do NOT need to run this: it executes
-- automatically on the first serverless cold start.
-- Run in the Neon SQL Editor only if you want to apply it
-- ahead of deploy or verify your database manually.
-- Safe to run multiple times (fully idempotent).
-- =========================================================

-- --- users: soft currency, premium/trial, family/class links, gamification
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'student';
ALTER TABLE users ADD COLUMN IF NOT EXISTS gems INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_freezes INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_used BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES users(user_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS class_code VARCHAR(12);
ALTER TABLE users ADD COLUMN IF NOT EXISTS share_leaderboard BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS freeze_used_on DATE;
CREATE INDEX IF NOT EXISTS idx_users_class_code ON users(class_code);

-- --- daily goals: extend with a speaking goal + chest flag
ALTER TABLE daily_goals ADD COLUMN IF NOT EXISTS target_speaking INTEGER DEFAULT 5;
ALTER TABLE daily_goals ADD COLUMN IF NOT EXISTS completed_speaking INTEGER DEFAULT 0;
ALTER TABLE daily_goals ADD COLUMN IF NOT EXISTS chest_claimed BOOLEAN DEFAULT FALSE;

-- --- spaced repetition review queue
CREATE TABLE IF NOT EXISTS review_queue (
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
);
CREATE INDEX IF NOT EXISTS idx_review_due ON review_queue(user_id, due_at);

-- --- game sessions (tone pairs etc.) + weekly leaderboard source
CREATE TABLE IF NOT EXISTS xp_logs (
    log_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    amount INTEGER NOT NULL,
    source VARCHAR(50) DEFAULT 'unknown',
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_xp_logs_ts ON xp_logs(timestamp);

CREATE TABLE IF NOT EXISTS game_sessions (
    session_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    game VARCHAR(40) NOT NULL,
    score INTEGER DEFAULT 0,
    correct INTEGER DEFAULT 0,
    total INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_game_sessions_game ON game_sessions(game, created_at);

CREATE TABLE IF NOT EXISTS placement_results (
    placement_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    recommended_level INTEGER NOT NULL,
    correct INTEGER DEFAULT 0,
    total INTEGER DEFAULT 0,
    answers JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- --- referral rewards
CREATE TABLE IF NOT EXISTS referral_rewards (
    reward_id SERIAL PRIMARY KEY,
    referrer_id INTEGER NOT NULL REFERENCES users(user_id),
    invited_email VARCHAR(150),
    invited_user_id INTEGER REFERENCES users(user_id),
    status VARCHAR(20) DEFAULT 'pending', -- pending | joined | rewarded
    reward VARCHAR(60),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- --- virtual classroom
CREATE TABLE IF NOT EXISTS classrooms (
    class_id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(user_id),
    class_code VARCHAR(12) UNIQUE NOT NULL,
    class_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- PREFLIGHT: base tables the feature pack queries but does
-- NOT create. These come from database_schema.sql and should
-- already exist in Neon. If any returns 0 rows, run the
-- matching CREATE TABLE from database_schema.sql first.
-- =========================================================
-- SELECT CASE WHEN to_regclass('public.users') IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS users,
--        CASE WHEN to_regclass('public.daily_goals') IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS daily_goals,
--        CASE WHEN to_regclass('public.user_progress') IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS user_progress,
--        CASE WHEN to_regclass('public.vocabulary_progress') IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS vocabulary_progress,
--        CASE WHEN to_regclass('public.notifications') IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS notifications;

-- =========================================================
-- VERIFY (run after): should list all 6 new tables
-- =========================================================
-- SELECT tablename FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('review_queue','xp_logs','game_sessions',
--                     'placement_results','referral_rewards','classrooms');
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'users'
--   AND column_name IN ('gems','streak_freezes','is_premium','trial_ends_at',
--                       'trial_used','parent_id','class_code',
--                       'share_leaderboard','freeze_used_on');
