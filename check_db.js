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

async function checkDatabase() {
  try {
    console.log('Connecting to database...');
    
    // Test the connection
    const testResult = await pool.query('SELECT NOW()');
    console.log('Connected to database successfully!\n');
    
    // Check existing tables
    console.log('Checking existing tables...');
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE';
    `);
    
    console.log('Existing tables:');
    tablesResult.rows.forEach(table => {
      console.log(`- ${table.table_name}`);
    });
    console.log('');
    
    // Check if users table has any records
    const userCount = await pool.query('SELECT COUNT(*) FROM users;');
    console.log(`Users in database: ${userCount.rows[0].count}`);
    
    if (parseInt(userCount.rows[0].count) > 0) {
      // Show a few sample users (without passwords)
      const sampleUsers = await pool.query('SELECT user_id, username, email, full_name, created_at FROM users LIMIT 5;');
      console.log('\nSample users:');
      sampleUsers.rows.forEach(user => {
        console.log(`ID: ${user.user_id}, Username: ${user.username}, Email: ${user.email}, Name: ${user.full_name}, Created: ${user.created_at}`);
      });
    } else {
      console.log('\nNo users found in database.');
      
      // Insert a sample user if none exist
      console.log('\nInserting a sample user...');
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.default.hash('Password123!', 10);
      
      const result = await pool.query(`
        INSERT INTO users (username, email, password_hash, full_name, xp, level, streak_days, is_verified, created_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
        RETURNING user_id, username, email, full_name
      `, [
        'testuser', 
        'test@example.com', 
        passwordHash, 
        'Test User', 
        0, 
        1, 
        0, 
        true, 
        new Date()
      ]);
      
      console.log('Sample user created:');
      console.log(`ID: ${result.rows[0].user_id}, Username: ${result.rows[0].username}, Email: ${result.rows[0].email}, Name: ${result.rows[0].full_name}`);
    }
    
    // Check other tables
    console.log('\nChecking other tables...');
    
    const progressCount = await pool.query('SELECT COUNT(*) FROM user_progress;');
    console.log(`Progress records: ${progressCount.rows[0].count}`);
    
    const achievementsCount = await pool.query('SELECT COUNT(*) FROM achievements;');
    console.log(`Achievements: ${achievementsCount.rows[0].count}`);
    
    const goalsCount = await pool.query('SELECT COUNT(*) FROM daily_goals;');
    console.log(`Daily goals: ${goalsCount.rows[0].count}`);
    
    const notificationsCount = await pool.query('SELECT COUNT(*) FROM notifications;');
    console.log(`Notifications: ${notificationsCount.rows[0].count}`);
    
    const settingsCount = await pool.query('SELECT COUNT(*) FROM user_settings;');
    console.log(`User settings: ${settingsCount.rows[0].count}`);
    
    const vocabCount = await pool.query('SELECT COUNT(*) FROM vocabulary_progress;');
    console.log(`Vocabulary records: ${vocabCount.rows[0].count}`);
    
  } catch (error) {
    console.error('Error checking database:', error);
    throw error;
  } finally {
    await pool.end();
    console.log('\nDatabase connection closed.');
  }
}

// Run the check
checkDatabase().catch(console.error);