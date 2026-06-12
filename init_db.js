import dotenv from 'dotenv';
import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the SQL schema from the database_schema.sql file
const schemaSQL = fs.readFileSync(path.join(__dirname, 'database_schema.sql'), 'utf8');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function initDatabase() {
  try {
    console.log('Connecting to database...');
    
    // Test the connection
    const testResult = await pool.query('SELECT NOW()');
    console.log('Connected to database successfully!');
    
    console.log('Creating tables...');
    
    // Execute the schema SQL
    await pool.query(schemaSQL);
    
    console.log('Database schema created successfully!');
    
    // Verify tables were created
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE';
    `);
    
    console.log('Tables created:');
    tablesResult.rows.forEach(table => {
      console.log(`- ${table.table_name}`);
    });
    
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    await pool.end();
    console.log('Database connection closed.');
  }
}

// Run the initialization
initDatabase().catch(console.error);