# HanVerse Admin baseline assessment

## Repository and deployment

The authoritative remote is `https://github.com/Andrew12345-create/Hanversechineselearning.git`. The Admin security changes were first implemented in isolation from `origin/main` at `38a4f2f`, then ported onto `hanverse-learn` at `c686067` with a three-way file merge against the shared server baseline. The destination branch has a separate history with 45 branch-only commits and no Git merge base with current `main`; its existing classroom, trial, onboarding, curriculum and learner work was retained. The main checkout has extensive pre-existing edits and Syncthing conflict/temp files; those remain untouched. `/admin` is already routed to `/admin.html` in the destination branch.

## Current functionality found

- `functions/server.js` contains the Express API, account login and JWT validation, user and parent endpoints, lessons/media CRUD, admin analytics, email campaign endpoints, audit logging, health summary, and Panda chat.
- PostgreSQL uses `users`, `user_progress`, `achievements`, `daily_goals`, `notifications`, `user_settings`, `vocabulary_progress`, feature-pack tables, and runtime-created parent/link/audit tables. There is no migration runner or versioned migration directory on `main`.
- Lesson content and media are database-backed. Parent profiles and relationships are in `parents`, `children`/`users.parent_id`, and runtime-created link tables. Premium/trial state is primarily on `users`; subscription/payment history and Stripe webhook behavior require further review before financial reporting.
- Existing checks are scripts rather than a configured test suite. Some scripts require `.env`, Neon, or mutate temporary database records. No credentials are available in this environment, so live database checks are not safe or possible.

## Security and functionality risks confirmed

- Admin elevation previously trusted body `userId`, disclosed account/password failure differences, and returned an eight-hour bearer JWT.
- `verifyAdminToken` accepted privileged bearer claims, then checked only `users.is_admin`; there was no role/permission model.
- `/admin/overview` returned every user row without pagination.
- Ban/delete did not prevent self-action, administrator targeting, or deleting the final super-admin. Audit writes could fail silently and were separate from mutations.
- Admin page was redirected to the Learn deployment; the current `main` branch lacked the page.
- Metrics do not currently cover verified revenue, provider delivery telemetry, backup history, or deployment health; these must remain unavailable unless real sources are added.

## Implementation roadmap

1. Restore Admin access on the authoritative repo, secure session elevation and permissions, add additive migration, paginated user search, destructive-action safeguards, and regression tests.
2. Build the real-data Launch/Analytics, learner support, parent safety, revenue/subscription, content, email, and classroom workflows using verified existing schemas/routes.
3. Add audit/incident controls, feature flags, AI monitoring, support workflow, and operational assistant only where authoritative data and permissions exist.
4. Run static, API, migration-review, and browser checks; document manual Neon migration and hosting requirements. Do not deploy or commit automatically.

## Current isolated implementation status

- Admin UI access is restored to this repository at `/admin` and `/admin.html`, with no-store response headers. The current page includes user pagination/search, parent review, email campaigns, lessons/media, audit filters, health and an operations briefing from returned database/provider metrics.
- Elevation now requires an ordinary authenticated login first; it resolves the actor from that login, then sets a 15-minute Secure, HttpOnly, SameSite=Strict cookie. Elevated requests recheck a revocable DB session, admin status and role permissions. Destructive and selected sensitive writes require a fresh password check.
- User suspension, profile updates, user deletion, lesson deletion, parent verification and campaign creation write their event in the same database transaction when applicable. The audit API is paginated/filterable. Delivery outcomes are recorded and campaigns are held if an audit write fails.
- Account and IP failed-elevation counters are persisted. User search is paginated and returns selected fields only; deletion displays actual FK impact and requires a typed username plus reason. Lesson deletion is blocked when actual linked learner progress exists.
- Promotional campaign selection is consent-only and sends recheck consent before delivery. Existing users default to opted out in the new preference table. There is not yet an Admin consent-capture/preferences UI, so campaign audience may be empty until another legitimate consent capture flow populates affirmative consent.
- Health values explicitly label unavailable telemetry. Email probe state is fresh for 15 minutes; AI/Stripe/backup/deployment values are only reported from configuration or available environment metadata. No financial revenue is derived from entitlement flags.

### Migration and deployment requirements

1. Review and apply `migrations/2026110501_admin_security.sql` manually to a verified Neon database before deploying the matching server code. It is additive and has rollback guidance; the app does not run it automatically.
2. Configure `ALLOWED_ORIGINS` to include the exact Admin origin, `JWT_SECRET`, normal login/database settings, and deployment metadata if available. Secure cookies require HTTPS.
3. Deploy the API and static Admin page in the same repository build. Validate the migration on a non-production database first, then smoke-test sign-in/elevation, permission denial, logout, parent review, deletion impact, campaign consent and audit rows.
4. No database migration or production deploy has been performed. The reviewed code is prepared for a branch commit and push; apply the migration manually only after database review.

### Remaining scope

The source branch still lacks authoritative schemas/routes for Stripe transaction history and webhook monitoring, trial lifecycle analytics, privacy request workflows, child consent capture, safety report queue, incidents, staff role assignment UI, feature flags, assignment/classroom operational controls, content approval/version/rollback workflow, AI usage/cost telemetry, comprehensive support case records, Panda admin assistant grounding/authorization, exports, and most expanded curriculum/gamification/Panda World controls. These must be implemented against inspected real schemas in later phases; they are not represented as completed UI features here. Existing content editing still exposes the established lesson/media CRUD, not the full requested CMS lifecycle.

## Verification

- `npm run test:admin`: static and inline-JavaScript checks.
- `node scripts/test-admin-fixes.mjs`: legacy Admin regression checks.
- `node --check functions/server.js` and both Admin test scripts.
- `npm run build` (the repository's configured build is a no-op static-site success).
- Live Neon queries, migration execution, provider delivery, browser/mobile accessibility runs, and deploy verification were not run because no database/provider credentials or production authorization are available in this isolated workspace.

### Additional source findings

- The separate feature-pack schema contains trial fields, classrooms, games, vocabulary review and XP tables; however, the Admin branch does not have sufficient teacher verification, assignment, entitlement lifecycle, or event telemetry routes for the requested comprehensive workspaces.
- The initial Admin page from the diverged source branch keeps a normal-user token in the platform's existing localStorage session for the `/login` handoff. The elevated token itself is never exposed to JavaScript. The normal token is only held in a temporary local variable during elevation.
- User password reset/security event history and mail delivery history are not persisted as queryable Admin records in the existing schema. The configured mail health probe shows process startup SMTP verification, not confirmed recipient delivery health.
- Campaigns require opt-in as the user did not provide an approved existing consent source; the new table defaults legacy users to opted out. Campaign cancellation and recipient outcomes are recorded, but a durable queue/worker and end-to-end provider delivery simulation still need a staging integration test.
- The Admin has not been run in a browser during this phase. Static JavaScript parsing passed; responsive visual and assistive-technology testing remains necessary.

## Scope note

History did not identify a six-file “initial Abacus Admin” set. The initial commits specifically name `admin.html` and `functions/server.js`; the latest Admin hardening commit also changes `scripts/test-admin-fixes.mjs`. No six-file set is being guessed.
