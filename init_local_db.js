#!/usr/bin/env node
/**
 * Initialize local database for Hanverse application
 */
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Default values for local development
const dbConfig = {
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hanverse_dev',
  password: process.env.DB_PASSWORD || 'postgres', // Default PostgreSQL password
  port: process.env.DB_PORT || 5432,
};

console.log('Initializing Hanverse database...');
console.log('Connecting to:', `${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
console.log('(Note: This script assumes PostgreSQL is running locally)');

async function initializeDatabase() {
  const client = new Client({
    user: dbConfig.user,
    host: dbConfig.host,
    password: dbConfig.password,
    port: dbConfig.port,
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL server');

    // Check if database exists
    const dbExists = await client.query(
      'SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1',
      [dbConfig.database]
    );

    if (dbExists.rowCount === 0) {
      // Create database
      await client.query(`CREATE DATABASE "${dbConfig.database}"`);
      console.log(`Database "${dbConfig.database}" created successfully`);
    } else {
      console.log(`Database "${dbConfig.database}" already exists`);
    }

    // Disconnect from server and connect to the specific database
    await client.end();

    // Connect to the target database
    const dbClient = new Client(dbConfig);
    await dbClient.connect();
    console.log(`Connected to database: ${dbConfig.database}`);

    // Create tables if they don't exist
    console.log('Creating tables...');

    // Users table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        streak_days INTEGER DEFAULT 0,
        profile_picture TEXT,
        is_admin BOOLEAN DEFAULT FALSE,
        is_banned BOOLEAN DEFAULT FALSE,
        banned_reason TEXT,
        is_verified BOOLEAN DEFAULT FALSE,
        last_active DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User progress table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS user_progress (
        progress_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id),
        course_type VARCHAR(20) NOT NULL, -- 'YCT' or 'HSK'
        course_level INTEGER NOT NULL,
        lesson_id INTEGER NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        score INTEGER,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, course_type, course_level, lesson_id)
      )
    `);

    // Achievements table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        achievement_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id),
        achievement_type VARCHAR(50) NOT NULL,
        achievement_name VARCHAR(100) NOT NULL,
        earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Daily goals table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS daily_goals (
        goal_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id),
        goal_date DATE NOT NULL,
        target_lessons INTEGER DEFAULT 1,
        completed_lessons INTEGER DEFAULT 0,
        target_xp INTEGER DEFAULT 10,
        earned_xp INTEGER DEFAULT 0,
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, goal_date)
      )
    `);

    // Notifications table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        notification_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id),
        title VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(20) DEFAULT 'info',
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User settings table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        setting_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id) UNIQUE,
        daily_reminder BOOLEAN DEFAULT TRUE,
        sound_enabled BOOLEAN DEFAULT TRUE,
        notifications_enabled BOOLEAN DEFAULT TRUE,
        language_preference VARCHAR(10) DEFAULT 'en',
        theme VARCHAR(20) DEFAULT 'light',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Vocabulary progress table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS vocabulary_progress (
        vocab_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id),
        word VARCHAR(100) NOT NULL,
        mastery_level INTEGER DEFAULT 0, -- 0-5 scale
        review_count INTEGER DEFAULT 0,
        last_reviewed TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Email verifications table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS email_verifications (
        user_id INTEGER PRIMARY KEY REFERENCES users(user_id),
        token TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `);

    // Password resets table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        user_id INTEGER PRIMARY KEY REFERENCES users(user_id),
        token TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `);

    console.log('All tables created successfully!');

    // Insert default admin user if none exists
    const adminCheck = await dbClient.query(
      'SELECT user_id FROM users WHERE is_admin = TRUE LIMIT 1'
    );

    if (adminCheck.rowCount === 0) {
      await dbClient.query(`
        INSERT INTO users (username, email, password_hash, full_name, is_admin, is_verified)
        VALUES ('admin', 'admin@hanverse.local', '$2b$10$uN8IU.iHUemZRjrsTY.EEOQ3zGrYKEOQ/K5Lh.7rJ3V.9kWuQnqkG', 'Administrator', TRUE, TRUE)
        ON CONFLICT (email) DO NOTHING
      `);
      console.log('Default admin user created (email: admin@hanverse.local, password: admin123)');
    } else {
      console.log('Admin user already exists');
    }

    await dbClient.end();
    console.log('\n✅ Database initialization completed successfully!');
    console.log('\nTo start the server:');
    console.log('1. Make sure your .env file has the correct database settings');
    console.log('2. Run: npm run dev:local');

  } catch (err) {
    console.error('\n❌ Error initializing database:', err.message);
    
    if (err.code === 'ECONNREFUSED') {
      console.error('\n💡 The PostgreSQL server is not running locally.');
      console.error('   Please install and start PostgreSQL, or use a cloud service.');
      console.error('   See LOCAL_DEV_SETUP.md for detailed instructions.');
    } else if (err.code === '28P01') {
      console.error('\n💡 Incorrect password for PostgreSQL user.');
      console.error('   Please check your DB_PASSWORD in the .env file.');
    } else {
      console.error('\n💡 Check your database configuration in .env file.');
    }
    
    process.exit(1);
  }
}

initializeDatabase();