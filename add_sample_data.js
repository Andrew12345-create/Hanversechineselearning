import dotenv from 'dotenv';
import pkg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config();

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function addSampleData() {
  try {
    console.log('Connecting to database...');
    
    // Test the connection
    const testResult = await pool.query('SELECT NOW()');
    console.log('Connected to database successfully!\n');
    
    // Get a user to use for sample data
    const users = await pool.query('SELECT user_id, username FROM users LIMIT 1;');
    if (users.rows.length === 0) {
      console.log('No users found. Creating a sample user first...');
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.default.hash('Password123!', 10);
      
      const newUser = await pool.query(`
        INSERT INTO users (username, email, password_hash, full_name, xp, level, streak_days, is_verified, created_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
        RETURNING user_id, username
      `, [
        'demo_user', 
        'demo@example.com', 
        passwordHash, 
        'Demo User', 
        0, 
        1, 
        0, 
        true, 
        new Date()
      ]);
      
      const userId = newUser.rows[0].user_id;
      console.log(`Created demo user with ID: ${userId}\n`);
    } else {
      const userId = users.rows[0].user_id;
      console.log(`Using existing user ID: ${userId} (${users.rows[0].username}) for sample data\n`);
      
      // Add some sample progress data
      console.log('Adding sample progress data...');
      await pool.query(`
        INSERT INTO user_progress (user_id, course_type, course_level, lesson_id, completed, score, completed_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [userId, 'HSK', 1, 1, true, 95, new Date()]);
      
      await pool.query(`
        INSERT INTO user_progress (user_id, course_type, course_level, lesson_id, completed, score, completed_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [userId, 'YCT', 1, 1, true, 87, new Date()]);
      
      console.log('Added 2 progress records.\n');
      
      // Add a sample achievement
      console.log('Adding sample achievement...');
      await pool.query(`
        INSERT INTO achievements (user_id, achievement_type, achievement_name, earned_at) 
        VALUES ($1, $2, $3, $4)
      `, [userId, 'first_login', 'First Login', new Date()]);
      
      console.log('Added 1 achievement.\n');
      
      // Add a sample daily goal
      console.log('Adding sample daily goal...');
      await pool.query(`
        INSERT INTO daily_goals (user_id, goal_date, target_lessons, completed_lessons, target_xp, earned_xp, completed) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [userId, new Date(), 20, 5, 100, 25, false]);
      
      console.log('Added 1 daily goal.\n');
      
      // Add a sample notification
      console.log('Adding sample notification...');
      await pool.query(`
        INSERT INTO notifications (user_id, title, message, type, is_read, created_at) 
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [userId, 'Welcome!', 'Welcome to Hanverse!', 'system', false, new Date()]);
      
      console.log('Added 1 notification.\n');
      
      // Add user settings if not exists
      console.log('Checking/adding user settings...');
      const settingsCheck = await pool.query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
      if (settingsCheck.rows.length === 0) {
        await pool.query(`
          INSERT INTO user_settings (user_id, daily_reminder, reminder_time, sound_enabled, notifications_enabled, language_preference, theme) 
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [userId, true, '09:00:00', true, true, 'en', 'light']);
        
        console.log('Added user settings.\n');
      } else {
        console.log('User settings already exist.\n');
      }
      
      // Add a sample vocabulary record
      console.log('Adding sample vocabulary progress...');
      await pool.query(`
        INSERT INTO vocabulary_progress (user_id, word, course_type, course_level, mastery_level, last_reviewed, review_count) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [userId, '你好', 'HSK', 1, 2, new Date(), 3]);
      
      console.log('Added 1 vocabulary record.\n');
    }
    
    // Summary report
    console.log('=== Database Summary ===');
    const tables = ['users', 'user_progress', 'achievements', 'daily_goals', 'notifications', 'user_settings', 'vocabulary_progress'];
    for (const table of tables) {
      const count = await pool.query(`SELECT COUNT(*) FROM ${table};`);
      console.log(`${table}: ${count.rows[0].count} records`);
    }
    
    console.log('\nSample data added successfully!');
    
  } catch (error) {
    console.error('Error adding sample data:', error);
    throw error;
  } finally {
    await pool.end();
    console.log('\nDatabase connection closed.');
  }
}

// Run the function
addSampleData().catch(console.error);