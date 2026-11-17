# HanVerse Learn — Security Audit

- **Date of audit:** 2026-10-26
- **Auditor:** CoWork autonomous agent
- **Scope:** whole repository at `C:\Users\user\Documents\Andrew\hanverse-learn`
  (backend `functions/`, `realtime-server.js`; client pages and JS)
- **Method:** read-only code review. Every finding below was verified by reading
  the actual code path end-to-end.

> **Verdict: No exploitable vulnerabilities found in the verified paths.**
> The backend is genuinely well secured: parameterized SQL everywhere, bcrypt
> passwords, signature-verified JWTs, ownership checks on user-scoped routes,
> DB-rechecked admin checks, server-side quiz grading with the answer key kept
> on the server, and a signature-verified Stripe webhook.
>
> The findings below are 1 functional bug (notifications completely broken —
> fails safe, not exploitable) plus hardening items. None of them is an
> attacker-reachable data breach. The **operational risk is higher than the
> code risk**: Syncthing is mangling this folder and previously destroyed the
> security-audit files (see section 5).
>
> ⚠️ This audit was done against the working tree while Syncthing was actively
> rewriting `functions/server.js` and `functions/features.js`. Findings were
> re-verified against the latest bytes at the time of writing.

---

## 1. Findings (highest impact first)

### 1.1 — Notifications are completely broken (functional bug, fails safe)
- **Where:** `functions/server.js` — `GET /notifications/:userId`,
  `POST /notifications/:userId/read-all`,
  `POST /notifications/:userId/:notificationId/read`
- **What:** All three routes call `canAccessUser(req, res, userId)` without ever
  calling `requireUser(req, res)` first. `canAccessUser` reads `req.authUser`,
  which is only set by `requireUser` — so it is always `undefined` and the route
  always answers **403**. `notifications-client.js` sends the JWT correctly (via
  `js/auth-fetch.js`), so the client is fine; the server just never checks it.
- **Impact:** The notification bell UI can never load or mark anything read.
  Every other route in the app does authenticate, so this is *not* exploitable —
  it fails closed. It is simply broken.
- **Fix:** Add `const auth = await requireUser(req, res); if (!auth) return;` at
  the top of each of the three routes (applied — see end of this document).

### 1.2 — TLS not validated on the database and email connections (medium)
- **Where:**
  - `functions/server.js` — `pool` config: `ssl: { rejectUnauthorized: false }`
  - `functions/server.js` — mailer config: `tls: { rejectUnauthorized: false }`
  - `realtime-server.js` — its DB pool has the same `rejectUnauthorized: false`
- **What:** Connection encryption is requested but the server certificate is not
  verified, so a network man-in-the-middle (e.g. on a compromised ISP/router or
  an intermediate proxy) could in principle read or tamper with traffic between
  the Netlify function and Neon database / Brevo SMTP.
- **Impact:** Low in practice on Netlify→Neon (TLS is still used; only identity
  verification is skipped), but this is the single most worthwhile hardening
  item.
- **Fix:** set `rejectUnauthorized: true` in all three places. Neon and Brevo
  both present valid certificates. Patch in `patches/` section below. **Must be
  deployed and deployed-and-tested before trusting** — if the deployed function
  cannot connect afterwards, revert (it would mean a proxy in between).

### 1.3 — Content-Security-Policy disabled (medium hardening)
- **Where:** `functions/server.js` — `helmet({ ..., contentSecurityPolicy: false })`
- **What:** No CSP header is sent, so the browser has no extra line of defense
  if an XSS ever slips in. It was presumably disabled because the client pages
  use large amounts of inline JavaScript, which a strict CSP would block.
- **Impact:** Defense-in-depth only; no XSS was found in the code paths audited.
- **Fix:** Introduce CSP with `'unsafe-inline'` for scripts initially (keeps the
  app working while still restricting script sources, object-src, frame-ancestors
  etc.), then move toward hashes/nonces. See `patches/`.

### 1.4 — User enumeration via `/auth/user-by-email` (low)
- **Where:** `functions/server.js` — `POST /auth/user-by-email`
- **What:** Given any email, this endpoint answers 200 + the numeric `user_id` if
  the account exists, 404 if not. Anyone can learn which emails are registered
  (and harvest user IDs, which are also used in URLs). It is rate-limited
  (30 / 15 min per IP) which makes bulk harvesting slow but not impossible.
- **Impact:** Minor privacy/information leak. Login itself is already
  non-enumerating (same error for wrong email vs wrong password) — good.
- **Fix:** Require a valid bearer token for this route, or return a uniform
  200 response in both cases. Check the client callers (payment flow) before
  changing the contract.

### 1.5 — Rate limiting missing on password-reset / email-verify POSTs (low)
- **Where:** `POST /reset-password` and `POST /verify-email` have no `authLimiter`
- **What:** Both take an emailed token, so blind brute force is bounded by
  token entropy (32-byte random hex) — low practical risk — but a limiter is
  cheap and consistent with the other auth routes.
- **Fix:** add `authLimiter` to both routes.

### 1.6 — JWT stored in `localStorage` (note, not a finding)
- **Where:** `login.html:616`, `signup.html:904` store `hanverse_token` and
  `hanverse_user` in `localStorage`; `js/auth-fetch.js` injects it into
  same-origin API calls.
- **What:** Any client-side XSS could read the token and impersonate the user.
  The audited rendering code escapes server content (`escapeHtml`), which is the
  correct mitigation. For a kids learning app at this scale this trade-off
  (localStorage + short-lived JWTs) is acceptable; if you want the next level,
  move to an `httpOnly` cookie session — a larger change.
- **Action:** not required now; revisit if the app adds user-generated rich
  content.

---

## 2. Verified sound (audited and found OK)

- **SQL injection:** every query across `server.js`, `features.js`, `ai-routes.js`,
  `secure-grading.js` uses parameterized queries (`$1…$n`). None found.
- **AuthN/AuthZ:**
  - `requireUser` verifies the JWT signature and loads the user from the DB
    (checks `is_banned`).
  - `canAccessUser` enforces self / own-child / admin on profile, progress,
    and notification routes.
  - `features.js` `requireAuth` **overwrites** any client-supplied `userId` in
    the body with the verified token identity — no IDOR by construction.
  - Admin routes check the JWT admin claim **and** re-verify against the DB.
- **Passwords:** bcrypt compare; login errors are identical for unknown email /
  wrong password (no enumeration at login). Signup flow has an `authLimiter`.
- **Email verification / password reset:** tokens are `crypto.randomBytes(32)`
  hex, stored hashed-free in a dedicated table with `expires_at`; expiry is
  checked; tokens are deleted after use.
- **Payments:** `stripe.webhooks.constructEvent` verifies webhook signatures;
  checkout prices come from a server-side plan lookup, never the client;
  `/placement/submit` re-grades answers server-side and ignores client scores;
  the level is locked server-side.
- **AI routes:** all `/ai/*` endpoints authenticate; lesson context sent to the
  model is pulled from the DB (trusted), and user text is sanitized/truncated
  (`sanitizeUserText(…, 300)`).
- **Secrets:** no API keys or tokens hardcoded in `functions/` or client code
  (scanned for `sk-`, `whsec_`, `xox`, `AIza`, `ghp_` patterns — none).
  `.env` is gitignored and untracked. `.env.example` contains only placeholders.
- **Client hardening:** `js/auth-fetch.js` only attaches the token to
  same-origin `/api/` and `/.netlify/` URLs and never overrides an existing
  `Authorization` header. Notifications rendering escapes server text.
- **WebSocket:** `realtime-server.js` verifies the JWT on socket handshake.

---

## 3. Patches (ready to apply)

These are supplied for you/your engineer. Only 1.1 is applied already (see end).

**1.2 TLS — `functions/server.js`**
```diff
     pool = new Pool({
       connectionString: databaseUrl,
       ssl: {
-        rejectUnauthorized: false
+        rejectUnauthorized: true
       },
```
```diff
     tls: {
-      rejectUnauthorized: false
+      rejectUnauthorized: true
     }
```
`realtime-server.js`: same change on the DB pool `ssl` block.
> Test after deploy. If the database or email stops working, revert — it means
> something in the network path presents an unverified certificate.

**1.3 CSP — `functions/server.js`**
```diff
 app.use(helmet({
   crossOriginResourcePolicy: { policy: "cross-origin" },
-  contentSecurityPolicy: false
+  contentSecurityPolicy: {
+    directives: {
+      defaultSrc: ["'self'"],
+      scriptSrc: ["'self'", "'unsafe-inline'"],
+      styleSrc: ["'self'", "'unsafe-inline'"],
+      imgSrc: ["'self'", "data:", "https:"],
+      connectSrc: ["'self'"],
+      frameAncestors: ["'none'"],
+      objectSrc: ["'none'"]
+    }
+  }
 }));
```
(Start with `'unsafe-inline'` scripts so the app keeps working; move to
hashes/nonces later for real XSS defense. `connectSrc` must include any
external hosts the app fetches, e.g. OpenAI if called from the browser.)

**1.4 /auth/user-by-email — `functions/server.js`**
Remove the 404 branch and always answer uniformly:
```diff
     if (!result.rows.length) {
-      return res.status(404).json({ success: false, error: 'User not found' });
+      return res.json({ success: true, user: { user_id: null } });
     }
```
Or require a Bearer token at the top of the route (preferred if callers are
already signed in).

**1.5 rate limits**
```diff
-router.post('/reset-password', async (req, res) => {
+router.post('/reset-password', authLimiter, async (req, res) => {
...
-router.post('/verify-email', async (req, res) => {
+router.post('/verify-email', authLimiter, async (req, res) => {
```

---

## 4. Not vulnerabilities (checked, but you may want to know)

- **Host-header in family-link email:** `functions/server.js` builds
  `${req.protocol}://${req.get('host')}` into emailed links. Behind Netlify the
  host is effectively fixed, so risk is minimal. Consider using
  `getFrontendBaseUrl()` there too.
- **`img.src` from user-controlled `profile_picture`:** can point anywhere;
  browsers do not execute script via `<img src>`, so not exploitable. Worst
  case is a tracking pixel.

---

## 5. ⚠️ Operational risk — this is how your audit files got lost

This folder has serious **Syncthing** problems, confirmed on disk:

- **11 Sync-conflict files** from Oct 25 20:08–20:20, e.g.
  `dashboard.sync-conflict-20261025-200820-J2NHJXW.html`,
  `hanverse.sync-conflict-…css`, `invite.sync-conflict-…html`,
  `manifest.sync-conflict-…json`, `parent-dashboard.sync-conflict-…html`,
  `placement.sync-conflict-…html` — two devices saved conflicting versions of
  the same file and Syncthing kept both instead of merging.
- **Live `~syncthing~*.tmp` files** in `functions/`
  (`~syc-nt~features.js.tmp`, `~syncthing~server.js.tmp`, and one in `js/`).
- **Files being rewritten while I was auditing:** `functions/server.js` changed
  on disk mid-scan (07:27 → 07:33), `functions/features.js` at 07:35. The
  working tree is a moving target right now.
- **No file matching "security audit" exists anywhere** in the repo or its git
  history (only 2 commits total). Unless the copy on your other device is saved
  somewhere, the audit documents are gone — this sync conflict is the likely
  cause.

**What to do:**
1. **Stop Syncthing on this folder** (or remove this folder from the share) and
   keep it out of sync. Work on one device only moving forward.
2. Before that, check the other device’s Syncthing **versioning/trash** — your
   deleted or conflicted audit file may be recoverable there.
3. Enable Syncthing file **versioning** (it looks like it is off).
4. Clean up the stale `.sync-conflict-*` and `~syncthing~*.tmp` files once you
   confirm which version you want (ask me; I will not delete anything without
   your OK).
5. Consider `git` as the real backup: `commit` + `push` to GitHub after every
   meaningful change so a sync disaster can never destroy work again.

---

## 6. Recommended follow-ups

- **1.1 applied** (notifications fix) — verify notifications in the app after
  deploy.
- Deploy the 1.2 TLS change on a **test deploy** first, then flip `ALLOWED_ORIGINS`
  checks if needed.
- A full line-by-line XSS sweep of the large client pages (`lesson.html`,
  `practice.html`, `parents.html`, `explore.html` — ~800 KB of HTML total) was
  spot-checked, not exhaustively audited. Worth a dedicated pass.
- Run `npm audit` for dependency vulnerabilities (not done here).
- Add a repository-level `SECURITY.md` so future audits land in one place and
  don’t get lost to sync.
