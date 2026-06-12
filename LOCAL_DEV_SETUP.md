# Local Development Setup Guide

This guide will help you set up the Hanverse application for local development.

## Prerequisites

1. **Node.js** (v14 or higher)
2. **PostgreSQL** database (either local installation or cloud service)

## Option 1: Using a Cloud PostgreSQL Service (Recommended for beginners)

### Using Supabase (Free Tier Available)

1. Go to [supabase.io](https://supabase.io) and create an account
2. Create a new project
3. Once created, go to Project Settings → Database
4. Copy the connection string or note the host, database name, username, and password
5. Update your `.env` file:

```env
DB_USER=your_supabase_username
DB_HOST=your_supabase_host.supabase.co
DB_NAME=postgres
DB_PASSWORD=your_supabase_password
DB_PORT=5432

# Rest of your configuration...
PORT=3000
HOST=localhost
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

### Using ElephantSQL (Alternative Free Option)

1. Go to [elephantsql.com](https://elephantsql.com) and create a free account
2. Create a new instance
3. Copy the URL and extract the credentials
4. Update your `.env` file accordingly

## Option 2: Installing PostgreSQL Locally (Recommended for full local development)

### On Windows (using Chocolatey)
```bash
choco install postgresql
```

### On Windows (using installer)
1. Download PostgreSQL from [postgresql.org](https://www.postgresql.org/download/windows/)
2. Run the installer and follow the setup wizard
3. Remember the password you set for the `postgres` user (default user is usually 'postgres')
4. Make sure PostgreSQL service is running (you can start it from Services.msc or using `pg_ctl`)

### Initialize Database (After PostgreSQL is installed and running)

1. Create and initialize the database using our script:
```bash
npm run init:db
```

This script will:
- Create the database if it doesn't exist
- Create all necessary tables
- Insert a default admin user (email: admin@hanverse.local, password: admin123)

## Running the Application

Once your database is set up:

1. Install dependencies:
```bash
npm install
```

2. If you haven't already initialized the database:
```bash
npm run init:db
```

3. Start the server:
```bash
npm run dev:local
```

The application will be available at `http://localhost:3000`.

## Environment Variables

Create a `.env` file in the root directory with your database configuration:

```env
# Database Configuration
DB_USER=postgres              # PostgreSQL username
DB_HOST=localhost             # PostgreSQL host
DB_NAME=hanverse_dev          # Database name
DB_PASSWORD=your_password     # PostgreSQL password
DB_PORT=5432                  # PostgreSQL port

# Email Configuration (Brevo SMTP) - Optional for basic functionality
# BREVO_SMTP_KEY=your_brevo_smtp_key

# Server Configuration
PORT=3000
HOST=localhost
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

## Troubleshooting

### Database Connection Issues
- Make sure PostgreSQL service is running
- Verify your `.env` file has correct credentials
- Check if firewall is blocking the connection
- Ensure the database exists

### If you get `ECONNREFUSED` error:
- Your PostgreSQL server is not running
- Wrong host/port in your configuration
- PostgreSQL is not installed

### If you get authentication errors:
- Check your database username and password in `.env`
- Make sure the database user has necessary permissions

### Default Admin Account
After running `npm run init:db`, you'll have a default admin account:
- Email: `admin@hanverse.local`
- Password: `admin123` (the actual password is hashed in the database)

## Quick Test

After setting up everything and running `npm run dev:local`, visit `http://localhost:3000` in your browser. You should see the application interface, and database operations should work properly.