# HanVerse Learn (learn-hanverse.netlify.app)

The logged-in HanVerse learning app, split out of the main marketing repo.

- **This repo** → https://learn-hanverse.netlify.app — learn, roadmap, lesson,
  practice, placement, explore, profile, dashboard, parents/parent-dashboard,
  child-profile, admin, payment, settings, notifications, invite, talk,
  auth (login/signup/forgot/reset/verify), banned, offline.
- **Main repo (`Hanverse`)** → https://hanverse.netlify.app — landing page and
  legal pages (privacy, terms, refunds, cookies). Its links point here; this
  repo's brand/legal links point back there.

## Architecture

- Static HTML/JS frontend (no build step), Netlify.
- Express API in `functions/server.js` served via `/api/*` →
  `/.netlify/functions/server` (netlify.toml redirect).
- Same Neon PostgreSQL database as the main site (both sites run the same
  backend code; the DB is the single source of truth).
- Realtime (lesson communities) runs on Render — see
  `<meta name="hanverse-realtime-url">` in `lesson.html` (`realtime-server.js`
  here is that server's source).
- Scheduled functions (retention/trial/league sweeps) are **no-ops in this
  repo** — they run only on the main site so emails and league rotations
  never execute twice.

## Local dev

```bash
npm install
npm run dev:local   # static + API via local-server.js
# or
npm start           # netlify dev
```

## Environment variables

See `.env.example` (annotated) — the deploy checklist is in there.
