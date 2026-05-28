# Backend Setup Instructions

## Prerequisites
- Node.js (v14 or higher)
- npm or yarn

## Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Configure database connection:**
The `.env` file already contains your Neon database connection string. Verify it matches:
```
DATABASE_URL=postgresql://neondb_owner:npg_2GbziUBo9RvI@ep-little-brook-airyxne9-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
PORT=3000
```

3. **Start the server:**
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000`.

## API Endpoints

### POST `/api/login`
Authenticates user and fetches all data from the database.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "user": { ... user data ... },
  "progress": [ ... course progress ... ],
  "achievements": [ ... achievements ... ],
  "dailyGoals": [ ... daily goals ... ],
  "notifications": [ ... notifications ... ],
  "settings": { ... user settings ... },
  "vocabulary": [ ... vocabulary progress ... ]
}
```

### POST `/api/signup`
Creates a new user account.

**Request:**
```json
{
  "email": "newuser@example.com",
  "password": "password123",
  "fullName": "John Doe",
  "username": "johndoe"
}
```

### GET `/api/user/:userId`
Fetches user data by ID.

## How It Works

1. **Login Flow:**
   - User submits email/password from login.html
   - Server queries PostgreSQL database for user
   - Password is verified using bcrypt
   - Server fetches all related user data (progress, achievements, notifications, etc.)
   - All data is stored in localStorage on the client
   - User is redirected to dashboard (index.html)

2. **Data Fetched on Login:**
   - User profile information
   - Course progress (YCT and HSK levels)
   - Achievements
   - Daily goals
   - Notifications
   - User settings (preferences)
   - Vocabulary progress

3. **Updates on Login:**
   - Last active date is updated
   - Streak days are recalculated
   - 10 XP is awarded for login
   - Level is updated if XP threshold reached

## Database Connection

The server uses the `pg` (node-postgres) library to connect to Neon PostgreSQL. The connection pool handles multiple requests efficiently.

## Security Notes

- Passwords are hashed using bcrypt (with salt rounds = 10)
- SSL/TLS is enabled for database connections
- CORS is enabled for localhost development
- Input validation is performed on all endpoints

For production, consider:
- Using environment variables for sensitive data
- Implementing JWT tokens for user sessions
- Adding rate limiting
- Restricting CORS origins
- Using HTTPS
