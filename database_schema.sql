-- Hanverse Database Schema (PostgreSQL)

-- Users/Profiles Table
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    streak_days INTEGER DEFAULT 0,
    last_active DATE,
    profile_picture VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_email ON users(email);
CREATE INDEX idx_username ON users(username);

-- User Progress Table
CREATE TABLE user_progress (
    progress_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    course_type VARCHAR(10) NOT NULL CHECK (course_type IN ('YCT', 'HSK')),
    course_level INTEGER NOT NULL,
    lesson_id INTEGER NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    score INTEGER,
    completed_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_user_course ON user_progress(user_id, course_type, course_level);

-- Achievements Table
CREATE TABLE achievements (
    achievement_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    achievement_type VARCHAR(50) NOT NULL,
    achievement_name VARCHAR(100) NOT NULL,
    earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_user_achievements ON achievements(user_id);

-- Daily Goals Table
CREATE TABLE daily_goals (
    goal_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    goal_date DATE NOT NULL,
    target_lessons INTEGER DEFAULT 20,
    completed_lessons INTEGER DEFAULT 0,
    target_xp INTEGER DEFAULT 100,
    earned_xp INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE (user_id, goal_date)
);

CREATE INDEX idx_user_date ON daily_goals(user_id, goal_date);

-- Notifications Table
CREATE TABLE notifications (
    notification_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(20) DEFAULT 'system' CHECK (type IN ('achievement', 'reminder', 'streak', 'system')),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_user_notifications ON notifications(user_id, is_read, created_at);

-- User Settings Table
CREATE TABLE user_settings (
    setting_id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL,
    daily_reminder BOOLEAN DEFAULT TRUE,
    reminder_time TIME DEFAULT '09:00:00',
    sound_enabled BOOLEAN DEFAULT TRUE,
    notifications_enabled BOOLEAN DEFAULT TRUE,
    language_preference VARCHAR(10) DEFAULT 'en',
    theme VARCHAR(20) DEFAULT 'light',
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Vocabulary Progress Table
CREATE TABLE vocabulary_progress (
    vocab_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    word VARCHAR(50) NOT NULL,
    course_type VARCHAR(10),
    course_level INTEGER,
    mastery_level INTEGER DEFAULT 0,
    last_reviewed TIMESTAMP,
    review_count INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_user_vocab ON vocabulary_progress(user_id, mastery_level);
