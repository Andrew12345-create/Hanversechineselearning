#!/usr/bin/env node

/**
 * Localhost startup script for Hanverse server
 * This script ensures the server runs properly on localhost with correct configuration
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

// Load environment variables from .env file if it exists
if (existsSync('.env')) {
  dotenv.config();
}

// Set default localhost configuration
process.env.HOST = process.env.HOST || 'localhost';
process.env.PORT = process.env.PORT || '3000';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || `http://${process.env.HOST}:${process.env.PORT}`;

console.log(`Starting Hanverse server on ${process.env.HOST}:${process.env.PORT}`);
console.log(`Environment: ${process.env.NODE_ENV}`);
console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);

// Check if database environment variables are set
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
  console.warn('\n⚠️  WARNING: Database environment variables not fully configured!');
  console.warn('Please set up your .env file with database credentials.');
  console.warn('See LOCAL_DEV_SETUP.md for instructions.\n');
}

console.log('----------------------------------------');

// Start the main server
const serverProcess = spawn('node', ['server.js'], {
  stdio: 'inherit',
  env: process.env
});

serverProcess.on('error', (err) => {
  console.error('Failed to start server:', err);
  console.error('\nPossible issues:');
  console.error('- Node.js not installed or not in PATH');
  console.error('- Missing dependencies (try running: npm install)');
  console.error('- Database not configured properly');
  console.error('- Port already in use');
  process.exit(1);
});

serverProcess.on('close', (code) => {
  console.log(`\nServer process exited with code ${code}`);
  if (code !== 0) {
    console.log('\nTroubleshooting tips:');
    console.log('- Check that PostgreSQL is running locally');
    console.log('- Verify your .env file has correct database credentials');
    console.log('- Make sure all dependencies are installed: npm install');
    console.log('- See LOCAL_DEV_SETUP.md for detailed setup instructions');
  }
  process.exit(code);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  serverProcess.kill();
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  serverProcess.kill();
});