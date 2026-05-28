# Deployment Guide - Netlify

## Prerequisites
1. A [Netlify](https://netlify.com) account
2. Your project pushed to GitHub/GitLab/Bitbucket

## Environment Variables
In Netlify Dashboard, go to **Site Settings > Environment Variables** and add:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `postgresql://neondb_owner:npg_2GbziUBo9RvI@ep-little-brook-airyxne9-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require` |
| `PORT` | `3000` |
| `NODE_ENV` | `production` |

## Deployment Steps

### Option 1: Deploy from Git
1. Connect your Git repository to Netlify
2. Configure build settings:
   - Build command: `npm run build` (or leave empty for static deploy)
   - Publish directory: `.`
3. Add environment variables in Netlify dashboard
4. Deploy site

### Option 2: Deploy via Netlify CLI
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Deploy
netlify deploy --prod --dir=.
```

## Important Notes

### For the Backend API
The `functions/server.js` is configured as a Netlify Function. API calls will be redirected:
- `/api/login` → Netlify Function
- `/api/signup` → Netlify Function
- `/api/user/:id` → Netlify Function

### Database
The app uses Neon PostgreSQL. The `DATABASE_URL` environment variable is required.

### Local Testing
To test locally with Netlify CLI:
```bash
netlify dev
```

This will start both the frontend and the serverless functions locally.
