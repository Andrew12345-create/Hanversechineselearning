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

async function runCommonOperations() {
  try {
    console.log('Connecting to database...');
    
    // Test the connection
    const testResult = await pool.query('SELECT NOW()');
    console.log('Connected to database successfully!\n');
    
    console.log('=== Hanverse Database Operations Guide ===\n');
    
    // 1. Query all users
    console.log('1. Query all users:');
    const users = await pool.query('SELECT user_id, username, email, full_name, created_at FROM users;');
    console.log(`Found ${users.rows.length} users:`);
    users.rows.forEach(user => {
      console.log(`   - ID: ${user.user_id}, Username: ${user.username}, Email: ${user.email}, Name: ${user.full_name}`);
    });
    console.log('');
    
    // 2. Get user progress
    console.log('2. Sample user progress:');
    const progress = await pool.query(`
      SELECT u.username, up.course_type, up.course_level, up.lesson_id, up.completed, up.score 
      FROM user_progress up 
      JOIN users u ON u.user_id = up.user_id 
      LIMIT 5;
    `);
    console.log(`Found ${progress.rows.length} progress records:`);
    progress.rows.forEach(p => {
      console.log(`   - User: ${p.username}, Course: ${p.course_type}${p.course_level}, Lesson: ${p.lesson_id}, Score: ${p.score}%`);
    });
    console.log('');
    
    // 3. Update user XP (example of an update operation)
    console.log('3. Updating user XP (example):');
    const updateUser = await pool.query('SELECT user_id, username, xp FROM users LIMIT 1;');
    if (updateUser.rows.length > 0) {
      const user = updateUser.rows[0];
      const newXp = user.xp + 50;
      const updatedUser = await pool.query(`
        UPDATE users 
        SET xp = $1, updated_at = CURRENT_TIMESTAMP 
        WHERE user_id = $2 
        RETURNING user_id, username, xp;
      `, [newXp, user.user_id]);
      
      console.log(`   - Updated ${updatedUser.rows[0].username}'s XP from ${user.xp} to ${updatedUser.rows[0].xp}`);
    }
    console.log('');
    
    // 4. Insert new achievement (example of an insert operation)
    console.log('4. Adding a new achievement (example):');
    const userForAchievement = await pool.query('SELECT user_id, username FROM users ORDER BY created_at DESC LIMIT 1;');
    if (userForAchievement.rows.length > 0) {
      const user = userForAchievement.rows[0];
      const newAchievement = await pool.query(`
        INSERT INTO achievements (user_id, achievement_type, achievement_name, earned_at) 
        VALUES ($1, $2, $3, $4) 
        RETURNING achievement_id, achievement_type, achievement_name;
      `, [user.user_id, 'streak_7_days', '7-Day Streak Challenge', new Date()]);
      
      console.log(`   - Added achievement "${newAchievement.rows[0].achievement_name}" for user ${user.username}`);
    }
    console.log('');
    
    // 5. Summary statistics
    console.log('5. Database Summary:');
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM user_progress) AS total_progress,
        (SELECT COUNT(*) FROM achievements) AS total_achievements,
        (SELECT COUNT(*) FROM notifications) AS total_notifications,
        (SELECT COUNT(*) FROM vocabulary_progress) AS total_vocabulary;
    `);
    
    const stat = stats.rows[0];
    console.log(`   - Total Users: ${stat.total_users}`);
    console.log(`   - Total Progress Records: ${stat.total_progress}`);
    console.log(`   - Total Achievements: ${stat.total_achievements}`);
    console.log(`   - Total Notifications: ${stat.total_notifications}`);
    console.log(`   - Total Vocabulary Records: ${stat.total_vocabulary}`);
    console.log('');
    
    // 6. Recent activity
    console.log('6. Recent user activity:');
    const recentActivity = await pool.query(`
      SELECT username, xp, level, streak_days, last_active 
      FROM users 
      WHERE last_active IS NOT NULL 
      ORDER BY last_active DESC 
      LIMIT 5;
    `);
    
    recentActivity.rows.forEach(activity => {
      console.log(`   - ${activity.username}: Level ${activity.level}, XP: ${activity.xp}, Streak: ${activity.streak_days} days, Last active: ${activity.last_active}`);
    });
    console.log('');
    
    console.log('Database operations completed successfully!');
    
  } catch (error) {
    console.error('Error during database operations:', error);
    throw error;
  } finally {
    await pool.end();
    console.log('\nDatabase connection closed.');
  }
}

// Run the operations
runCommonOperations().catch(console.error);