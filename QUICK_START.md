# 🚀 Quick Start Guide - Login with Database Integration

## What's New

Your HanVerse app now has a complete backend system that:
- ✅ Authenticates users against your PostgreSQL database
- ✅ Fetches ALL user data on login (profile, progress, achievements, goals, etc.)
- ✅ Updates user stats (XP, level, streak) on each login
- ✅ Uses secure password hashing with bcrypt
- ✅ Stores all data in both database and localStorage for offline access

## Setup in 3 Steps

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Create Test User (Optional)

Create a migration file or run this SQL in Neon Console to create a test user:

```sql
-- Hashed password for 'password123'
INSERT INTO users (username, email, password_hash, full_name, last_active)
VALUES (
  'testuser',
  'test@example.com',
  '$2b$10$Kn1KnjZpmdphHY/jJKFaP.OlXgVfwJKz5xWr1gIdl0EGMYxNbJqnS',
  'Test User',
  CURRENT_DATE
);

INSERT INTO user_settings (user_id)
VALUES ((SELECT user_id FROM users WHERE email = 'test@example.com'));
```

### Step 3: Run the Server
```bash
npm start
```

Server will start on: **http://localhost:3000**

## Testing the Login

1. Open **http://localhost:3000/login.html** in your browser
2. Use test credentials:
   - Email: `test@example.com`
   - Password: `password123`
3. All user data will be fetched and stored, then redirect to dashboard

## File Structure

```
HanVerse/
├── server.js                 (Backend server - handles auth & database)
├── package.json              (Node.js dependencies)
├── .env                       (Database connection string)
├── login.html                (Updated - uses API)
├── signup.html               (Updated - uses API)
├── database_schema.sql       (PostgreSQL schema)
├── BACKEND_SETUP.md          (Detailed backend documentation)
├── DATABASE_MIGRATION.md     (Password migration guide)
├── QUICK_START.md            (This file)
└── ... (other HTML files)
```

## What Gets Stored on Login

When a user logs in, the following is fetched and stored in localStorage:

```javascript
{
  // User Profile
  user: {
    user_id, username, email, full_name, xp, level, 
    streak_days, profile_picture, created_at
  },
  
  // Learning Progress
  progress: [...],          // Course progress (YCT, HSK levels)
  achievements: [...],      // Earned achievements
  dailyGoals: [...],        // Today's goals
  
  // Communication & Settings
  notifications: [...],     // User notifications
  settings: {...},          // User preferences
  vocabulary: [...]         // Vocabulary mastery levels
}
```

## Database Updates on Login

- **Last Active**: Set to current date
- **Streak Days**: Incremented if user logged in yesterday
- **XP**: +10 bonus for logging in
- **Level**: Auto-upgrades when XP reaches level threshold

## API Endpoints Available

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/login` | Authenticate user & fetch all data |
| POST | `/api/signup` | Create new account |
| GET | `/api/user/:userId` | Fetch user data by ID |

## Troubleshooting

### Server won't start
- Check if port 3000 is available: `netstat -ano | findstr :3000`
- Kill existing process: `netstat -ano | findstr :3000 | find :3000 && taskkill /PID <pid> /F`

### "Connection error" on login
- Make sure server is running: `npm start`
- Check `.env` file has correct DATABASE_URL
- Verify database connection: `psql DATABASE_URL`

### "Invalid email or password"
- Create test user using SQL above
- Check password is exactly `password123`
- Verify CORS is not blocking requests (should show in browser console)

## Next Steps

1. Update profile.html to load user data from localStorage
2. Implement logout endpoint and clear localStorage
3. Add JWT tokens for production security
4. Set up password reset functionality
5. Add email verification

## Security Reminders

For production deployment:
- Set `NODE_ENV=production`
- Use environment variables for all secrets
- Enable HTTPS
- Implement CSRF protection
- Add rate limiting
- Restrict CORS origins
- Consider JWT tokens instead of localStorage
