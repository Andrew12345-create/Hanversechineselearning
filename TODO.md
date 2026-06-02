# TODO - DB Connection & Multi-page Support

- [x] Update `.env` with Neon Postgres connection string as `DATABASE_URL`
- [x] Update `server.js` to ensure Neon SSL settings work with pg (no incorrect SSL override)
- [x] Update `server.js` to listen on `0.0.0.0` so pages can reach API in more environments
- [x] Add `GET /api/health/db` endpoint for quick verification (`SELECT 1`)
- [x] Start server and verify `/api/health/db`
- [x] Smoke test login/signup flows




