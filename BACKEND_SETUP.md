# Backend Setup Instructions

## Prerequisites
- Node.js (v14 or higher)
- npm or yarn

## Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment variables:**
Copy `.env.example` to `.env` and set the appropriate values:

```
# Database Configuration
DB_USER=your_db_user
DB_HOST=localhost
DB_NAME=your_database_name
DB_PASSWORD=your_db_password
DB_PORT=5432

# Email Configuration (Brevo SMTP)
BREVO_SMTP_KEY=your_brevo_smtp_key   # required for verification + password reset emails
EMAIL_FROM="Hanverse" <your-verified-sender@yourdomain.com>   # recommended; verified sender in Brevo

# Frontend URL Configuration
FRONTEND_URL=http://localhost:3000   # for localhost development
# FRONTEND_URL=https://hanverse.netlify.app   # for production (uncomment when deploying)

# Server Configuration
PORT=3000                            # port to run the server on
HOST=0.0.0.0                         # host to bind to (0.0.0.0 for external access, localhost for local-only)
NODE_ENV=development                 # development or production
```

**Important notes:**
- The `BREVO_SMTP_KEY` is required if you want verification and password reset emails to send
- For localhost development, `FRONTEND_URL` should be set to `http://localhost:3000` to ensure email links work properly
- When deploying to production, update `FRONTEND_URL` to your production URL
- The `HOST` variable controls whether the server accepts connections from external addresses (use 0.0.0.0) or only local connections (use localhost/127.0.0.1)

3. **Start the server:**
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000` (or whatever host/port you've configured).

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

## Localhost vs Production Configuration

The server automatically detects the environment and adjusts email links accordingly:
- In development (`NODE_ENV=development`): Email links point to `http://localhost:3000` for local testing
- In production: Email links point to the production URL specified in `FRONTEND_URL`

## Database Connection

The server uses the `pg` (node-postgres) library to connect to PostgreSQL. The connection pool handles multiple requests efficiently.

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
