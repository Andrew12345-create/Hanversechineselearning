#!/usr/bin/env node
/**
 * Simple script to test database connection
 */
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Support both DATABASE_URL and individual DB params for local connections
const pool = (process.env.DATABASE_URL || process.env.NEON_DATABASE_URL)
  ? new Pool({
      connectionString: (process.env.DATABASE_URL || process.env.NEON_DATABASE_URL).replace(/^psql\s+/i, '').replace(/^['"]|['"]$/g, ''),
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'hanverse_dev',
      password: process.env.DB_PASSWORD || 'postgres',
      port: process.env.DB_PORT || 5432,
    });

console.log('Testing database connection...');
console.log('Configuration:');
console.log(`  Host: ${process.env.DB_HOST || 'localhost'}`);
console.log(`  Database: ${process.env.DB_NAME || 'hanverse_dev'}`);
console.log(`  User: ${process.env.DB_USER || 'postgres'}`);
console.log(`  Port: ${process.env.DB_PORT || 5432}`);

async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('\n✅ Database connection successful!');
    console.log('Current timestamp from database:', result.rows[0].now);
    client.release();
    
    // Test if our tables exist
    try {
      const tablesResult = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name IN ('users', 'user_progress', 'achievements', 'daily_goals', 'notifications', 'user_settings', 'vocabulary_progress', 'email_verifications', 'password_resets')
      `);
      
      console.log(`\nFound ${tablesResult.rows.length} Hanverse tables in the database`);
      if (tablesResult.rows.length > 0) {
        console.log('Tables:', tablesResult.rows.map(r => r.table_name).join(', '));
      }
    } catch (tableErr) {
      console.log('\n⚠️ Could not verify table existence:', tableErr.message);
    }
    
    await pool.end();
    console.log('\nTest completed successfully!');
  } catch (err) {
    console.error('\n❌ Database connection failed:', err.message);
    
    if (err.code === 'ECONNREFUSED') {
      console.error('\n💡 The PostgreSQL server is not running locally.');
      console.error('   Please install and start PostgreSQL.');
      console.error('   On Windows, you can start PostgreSQL from Services.msc');
    } else if (err.code === '28P01') {
      console.error('\n💡 Incorrect username or password for PostgreSQL.');
      console.error('   Please check your DB_USER and DB_PASSWORD in the .env file.');
    } else if (err.code === '3D000') {
      console.error('\n💡 Database does not exist.');
      console.error('   Run: npm run init:db to create the database and tables');
    }
    
    await pool.end();
    process.exit(1);
  }
}

testConnection();