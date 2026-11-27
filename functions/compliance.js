/* =========================================================
   HANVERSE COMPLIANCE — consent records, deletion requests,
   retention schedule, session revocation and admin TOTP MFA.

   Design notes:
   - Schema changes are idempotent, like features.js and
     dictionary.js, so they are safe to run on every boot.
   - Every route that touches a child resolves the subject from
     the authenticated session or from a verified parent link.
     A client-supplied child id is never trusted on its own.
   - Consent rows are append-only: withdrawal sets withdrawn_at
     and never deletes the original grant, so the history of what
     a guardian agreed to, and when, survives.
   - The retention purge is dry-run unless the caller passes
     confirm: true, and only touches tables on an explicit
     allow-list. Nothing here drops or truncates.
   ========================================================= */
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';

let pool = null;
let schemaReady = false;

const ok = (res, json) => res.json({ success: true, ...json });
const fail = (res, code, error) => res.status(code).json({ success: false, error });

/* Purposes a guardian can grant or withdraw independently. Essential
   service purposes are listed so the UI can show them as required
   rather than optional, but they are still recorded explicitly. */
export const CONSENT_PURPOSES = [
  'core_service',
  'progress_tracking',
  'classroom_participation',
  'leaderboard_display',
  'photographs',
  'audio_recording',
  'ai_tutor',
  'marketing_email'
];

export const OPTIONAL_PURPOSES = CONSENT_PURPOSES.filter(p => p !== 'core_service');

/* Retention schedule. Days are the maximum; the purge only ever
   removes rows older than the window. */
export const RETENTION_SCHEDULE = [
  { category: 'security_events', days: 365, basis: 'Security monitoring and incident investigation' },
  { category: 'notifications', days: 180, basis: 'In-app notification history' },
  { category: 'game_sessions', days: 365, basis: 'Learning activity records' },
  { category: 'ai_usage_daily', days: 60, basis: 'Daily AI usage and abuse-prevention counters' },
  { category: 'admin_audit', days: 730, basis: 'Privileged action accountability' },
  { category: 'consent_records', days: null, basis: 'Retained while the account exists — proves lawful basis' },
  { category: 'deletion_requests', days: 730, basis: 'Evidence that erasure was carried out' }
];

/* Only these tables may be purged, and only by their own timestamp
   column. Adding a table here is a deliberate act. */
const PURGEABLE = {
  security_events: 'created_at',
  notifications: 'created_at',
  game_sessions: 'created_at',
  ai_usage_daily: 'usage_date'
};

/* ── TOTP (RFC 6238) ────────────────────────────────────────
   Implemented on node:crypto so no new dependency is needed.
   SHA-1, 30-second step, 6 digits — what every authenticator
   app expects. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input) {
  const clean = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secret, step = Math.floor(Date.now() / 30000)) {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

/* Accepts the current step and one step either side, which is the
   usual tolerance for clock drift. */
export function verifyTotp(secret, code) {
  const candidate = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return false;
  const now = Math.floor(Date.now() / 30000);
  for (const step of [now - 1, now, now + 1]) {
    const expected = totpCode(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) return true;
  }
  return false;
}

export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/* Encrypt TOTP seeds at rest. Set ADMIN_MFA_ENCRYPTION_KEY to a stable
   32-byte-or-longer secret; JWT_SECRET is the backwards-compatible fallback. */
function mfaEncryptionKey() {
  const material = process.env.ADMIN_MFA_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!material) throw new Error('ADMIN_MFA_ENCRYPTION_KEY (or JWT_SECRET fallback) is required for admin MFA.');
  return crypto.createHash('sha256').update(material).digest();
}

export function encryptTotpSecret(secret) {
  const value = String(secret || '');
  if (value.startsWith('enc:v1:')) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', mfaEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptTotpSecret(stored) {
  const value = String(stored || '');
  if (!value.startsWith('enc:v1:')) return value; // migrate legacy plaintext records on schema setup
  const parts = value.split(':');
  if (parts.length !== 5) throw new Error('Stored admin MFA secret has an invalid encrypted format.');
  const [, version, ivText, tagText, encryptedText] = parts;
  if (version !== 'v1') throw new Error('Unsupported admin MFA secret encryption version.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', mfaEncryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

/* ── Schema ───────────────────────────────────────────────── */
export async function ensureComplianceSchema(sharedPool) {
  if (schemaReady) return;
  const db = sharedPool || pool;
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS consent_records (
      id SERIAL PRIMARY KEY,
      subject_user_id INTEGER NOT NULL,
      guardian_user_id INTEGER,
      purpose VARCHAR(40) NOT NULL,
      policy_version VARCHAR(20) NOT NULL,
      granted BOOLEAN NOT NULL DEFAULT TRUE,
      granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
      withdrawn_at TIMESTAMP,
      ip VARCHAR(64),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_consent_subject ON consent_records(subject_user_id, purpose);
    CREATE INDEX IF NOT EXISTS idx_consent_guardian ON consent_records(guardian_user_id);

    CREATE TABLE IF NOT EXISTS deletion_requests (
      id SERIAL PRIMARY KEY,
      subject_user_id INTEGER NOT NULL,
      requested_by INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reason TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMP,
      resolved_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_deletion_status ON deletion_requests(status, created_at);

    CREATE TABLE IF NOT EXISTS retention_policy (
      data_category VARCHAR(60) PRIMARY KEY,
      retention_days INTEGER,
      basis TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS security_events (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(60) NOT NULL,
      user_id INTEGER,
      ip VARCHAR(64),
      detail TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at);

    CREATE TABLE IF NOT EXISTS admin_mfa (
      user_id INTEGER PRIMARY KEY,
      secret TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      confirmed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE admin_mfa ALTER COLUMN secret TYPE TEXT;
  `);

  // Upgrade existing plaintext TOTP seeds in place. New writes are always encrypted.
  const legacyMfa = await db.query(`SELECT user_id, secret FROM admin_mfa WHERE secret NOT LIKE 'enc:v1:%'`);
  for (const row of legacyMfa.rows) {
    await db.query('UPDATE admin_mfa SET secret = $1 WHERE user_id = $2', [
      encryptTotpSecret(row.secret),
      row.user_id
    ]);
  }

  for (const row of RETENTION_SCHEDULE) {
    await db.query(
      `INSERT INTO retention_policy (data_category, retention_days, basis)
       VALUES ($1, $2, $3)
       ON CONFLICT (data_category) DO UPDATE
         SET retention_days = EXCLUDED.retention_days,
             basis = EXCLUDED.basis,
             updated_at = NOW()`,
      [row.category, row.days, row.basis]
    );
  }

  schemaReady = true;
}

/* ── Helpers ──────────────────────────────────────────────── */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim().slice(0, 64);
  return String(req.ip || '').slice(0, 64);
}

async function logSecurityEvent(db, eventType, userId, req, detail) {
  try {
    await db.query(
      'INSERT INTO security_events (event_type, user_id, ip, detail) VALUES ($1, $2, $3, $4)',
      [eventType, userId || null, clientIp(req), detail ? String(detail).slice(0, 500) : null]
    );
  } catch {
    /* Monitoring must never break the request it is observing. */
  }
}

/* A guardian may act for a child only through a verified link. */
async function guardianOwnsChild(db, guardianUserId, childUserId) {
  // The canonical profile relationship is children.parent_id -> parents.parent_id,
  // while parents.user_id identifies the guardian's authenticated account.
  // parents.is_verified is the safety-review gate (not users.is_verified,
  // which means email verification).
  const r = await db.query(
    `SELECT 1
       FROM children c
       JOIN parents p ON p.parent_id = c.parent_id
       JOIN users guardian ON guardian.user_id = p.user_id
      WHERE c.user_id = $1
        AND p.user_id = $2
        AND guardian.role = 'parent'
        AND COALESCE(guardian.is_verified, FALSE) = TRUE
        AND COALESCE(guardian.is_banned, FALSE) = FALSE
        AND COALESCE(c.is_active, TRUE) = TRUE
        AND COALESCE(p.is_active, TRUE) = TRUE
        AND COALESCE(p.is_verified, FALSE) = TRUE
      LIMIT 1`,
    [childUserId, guardianUserId]
  );
  return r.rowCount > 0;
}

/* Resolves the subject of a consent or deletion action. A caller may
   always act for themselves; a parent may act for a linked child. */
async function resolveSubject(db, auth, requestedId) {
  const self = Number(auth.user_id);
  if (!requestedId || Number(requestedId) === self) return self;
  const target = Number(requestedId);
  if (!Number.isInteger(target) || target <= 0) return null;
  if (await guardianOwnsChild(db, self, target)) return target;
  return null;
}

/* ── Routes ───────────────────────────────────────────────── */
export function registerComplianceRoutes(router, sharedPool, deps) {
  pool = sharedPool;
  const { requireUser, verifyAdminToken } = deps;

  const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Please wait a moment.' }
  });

  /* requireUser resolves the caller and returns the row, or writes the
     error response itself. Wrap it so every route below can rely on
     req.user being present. */
  const requireAuth = (req, res, next) => {
    Promise.resolve(requireUser(req, res))
      .then(user => {
        if (!user) return;
        req.user = user;
        next();
      })
      .catch(() => fail(res, 500, 'Authentication check failed.'));
  };

  /* ── Consent ──────────────────────────────────────────── */
  router.get('/compliance/consents', requireAuth, async (req, res) => {
    const auth = req.user;
    const subject = await resolveSubject(pool, auth, req.query.subject);
    if (!subject) return fail(res, 403, 'You cannot view consent for that account.');

    const r = await pool.query(
      `SELECT id, subject_user_id, guardian_user_id, purpose, policy_version,
              granted, granted_at, withdrawn_at
         FROM consent_records
        WHERE subject_user_id = $1
        ORDER BY purpose, granted_at DESC`,
      [subject]
    );
    ok(res, { subject, purposes: CONSENT_PURPOSES, optional: OPTIONAL_PURPOSES, records: r.rows });
  });

  router.post('/compliance/consents', requireAuth, writeLimiter, async (req, res) => {
    const auth = req.user;
    const { purpose, policyVersion, granted } = req.body || {};
    if (!CONSENT_PURPOSES.includes(purpose)) return fail(res, 400, 'Unknown consent purpose.');
    if (typeof granted !== 'boolean') return fail(res, 400, 'granted must be true or false.');
    if (purpose === 'core_service' && granted === false) {
      return fail(res, 400, 'The core service consent cannot be withdrawn while the account is active. Request deletion instead.');
    }
    const version = String(policyVersion || '').slice(0, 20);
    if (!version) return fail(res, 400, 'policyVersion is required.');

    const subject = await resolveSubject(pool, auth, req.body.subject);
    if (!subject) return fail(res, 403, 'You cannot change consent for that account.');

    const r = await pool.query(
      `INSERT INTO consent_records
         (subject_user_id, guardian_user_id, purpose, policy_version, granted, ip)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, purpose, granted, granted_at`,
      [subject, Number(auth.user_id) === subject ? null : Number(auth.user_id), purpose, version, granted, clientIp(req)]
    );
    await logSecurityEvent(pool, 'consent_recorded', subject, req, `${purpose}=${granted} v${version}`);
    ok(res, { record: r.rows[0] });
  });

  router.post('/compliance/consents/:id/withdraw', requireAuth, writeLimiter, async (req, res) => {
    const auth = req.user;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return fail(res, 400, 'Invalid consent id.');

    const found = await pool.query(
      'SELECT id, subject_user_id, purpose, withdrawn_at FROM consent_records WHERE id = $1',
      [id]
    );
    const row = found.rows[0];
    if (!row) return fail(res, 404, 'Consent record not found.');
    if (row.purpose === 'core_service') {
      return fail(res, 400, 'The core service consent cannot be withdrawn while the account is active.');
    }

    const subject = await resolveSubject(pool, auth, row.subject_user_id);
    if (!subject) return fail(res, 403, 'You cannot withdraw consent for that account.');
    if (row.withdrawn_at) return ok(res, { alreadyWithdrawn: true, id: row.id });

    await pool.query('UPDATE consent_records SET withdrawn_at = NOW() WHERE id = $1', [id]);
    await logSecurityEvent(pool, 'consent_withdrawn', subject, req, row.purpose);
    ok(res, { withdrawn: true, id: row.id, purpose: row.purpose });
  });

  /* ── Deletion requests ────────────────────────────────── */
  router.post('/compliance/deletion-requests', requireAuth, writeLimiter, async (req, res) => {
    const auth = req.user;
    const subject = await resolveSubject(pool, auth, req.body && req.body.subject);
    if (!subject) return fail(res, 403, 'You cannot request deletion for that account.');

    const open = await pool.query(
      `SELECT id FROM deletion_requests
        WHERE subject_user_id = $1 AND status = 'pending' LIMIT 1`,
      [subject]
    );
    if (open.rowCount) return ok(res, { alreadyPending: true, id: open.rows[0].id });

    const r = await pool.query(
      `INSERT INTO deletion_requests (subject_user_id, requested_by, reason)
       VALUES ($1, $2, $3)
       RETURNING id, status, created_at`,
      [subject, Number(auth.user_id), String((req.body && req.body.reason) || '').slice(0, 1000) || null]
    );
    await logSecurityEvent(pool, 'deletion_requested', subject, req, `by ${auth.user_id}`);
    ok(res, { request: r.rows[0] });
  });

  router.get('/compliance/deletion-requests', requireAuth, async (req, res) => {
    const auth = req.user;
    const subject = await resolveSubject(pool, auth, req.query.subject);
    if (!subject) return fail(res, 403, 'You cannot view deletion requests for that account.');
    const r = await pool.query(
      `SELECT id, status, reason, created_at, resolved_at
         FROM deletion_requests WHERE subject_user_id = $1
        ORDER BY created_at DESC LIMIT 50`,
      [subject]
    );
    ok(res, { subject, requests: r.rows });
  });

  router.get('/admin/compliance/deletion-requests', verifyAdminToken, async (req, res) => {
    const status = String(req.query.status || 'pending');
    if (!['pending', 'approved', 'rejected', 'completed'].includes(status)) {
      return fail(res, 400, 'Unknown status filter.');
    }
    const r = await pool.query(
      `SELECT d.id, d.subject_user_id, d.requested_by, d.status, d.reason,
              d.created_at, d.resolved_at,
              u.username, u.full_name
         FROM deletion_requests d
         LEFT JOIN users u ON u.user_id = d.subject_user_id
        WHERE d.status = $1
        ORDER BY d.created_at ASC LIMIT 200`,
      [status]
    );
    ok(res, { status, requests: r.rows });
  });

  router.patch('/admin/compliance/deletion-requests/:id', verifyAdminToken, writeLimiter, async (req, res) => {
    const id = Number(req.params.id);
    const { status, notes } = req.body || {};
    if (!Number.isInteger(id)) return fail(res, 400, 'Invalid request id.');
    if (!['approved', 'rejected', 'completed'].includes(status)) {
      return fail(res, 400, 'status must be approved, rejected or completed.');
    }
    const r = await pool.query(
      `UPDATE deletion_requests
          SET status = $1, notes = COALESCE($2, notes), resolved_at = NOW(), resolved_by = $3
        WHERE id = $4 AND status <> 'completed'
        RETURNING id, status, resolved_at`,
      [status, notes ? String(notes).slice(0, 1000) : null, req.adminUserId, id]
    );
    if (!r.rowCount) return fail(res, 404, 'Request not found or already completed.');
    await logSecurityEvent(pool, 'deletion_resolved', r.rows[0].id, req, `${status} by admin ${req.adminUserId}`);
    ok(res, { request: r.rows[0] });
  });

  /* ── Retention ────────────────────────────────────────── */
  router.get('/admin/compliance/retention', verifyAdminToken, async (_req, res) => {
    const r = await pool.query(
      'SELECT data_category, retention_days, basis, updated_at FROM retention_policy ORDER BY data_category'
    );
    ok(res, { schedule: r.rows, purgeable: Object.keys(PURGEABLE) });
  });

  router.post('/admin/compliance/retention/purge', verifyAdminToken, writeLimiter, async (req, res) => {
    const confirm = req.body && req.body.confirm === true;
    const report = [];
    for (const [table, column] of Object.entries(PURGEABLE)) {
      const policy = RETENTION_SCHEDULE.find(p => p.category === table);
      if (!policy || !policy.days) continue;
      const countSql = `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} < NOW() - ($1 || ' days')::interval`;
      const counted = await pool.query(countSql, [String(policy.days)]);
      const n = counted.rows[0].n;
      if (confirm && n > 0) {
        await pool.query(
          `DELETE FROM ${table} WHERE ${column} < NOW() - ($1 || ' days')::interval`,
          [String(policy.days)]
        );
      }
      report.push({ table, retentionDays: policy.days, eligible: n, purged: confirm ? n : 0 });
    }
    if (confirm) {
      await logSecurityEvent(pool, 'retention_purge', null, req, JSON.stringify(report));
    }
    ok(res, { dryRun: !confirm, report });
  });

  /* ── Session revocation ───────────────────────────────── */
  router.post('/auth/logout-all', requireAuth, writeLimiter, async (req, res) => {
    const auth = req.user;
    const r = await pool.query(
      'UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE user_id = $1 RETURNING token_version',
      [auth.user_id]
    );
    await logSecurityEvent(pool, 'sessions_revoked', auth.user_id, req, `version ${r.rows[0].token_version}`);
    ok(res, { revoked: true, tokenVersion: r.rows[0].token_version });
  });

  /* ── Admin MFA ────────────────────────────────────────── */
  router.get('/admin/mfa/status', verifyAdminToken, async (req, res) => {
    const r = await pool.query(
      'SELECT enabled, confirmed_at FROM admin_mfa WHERE user_id = $1',
      [req.adminUserId]
    );
    ok(res, { enrolled: r.rowCount > 0, enabled: !!(r.rows[0] && r.rows[0].enabled) });
  });

  router.post('/admin/mfa/enroll', verifyAdminToken, writeLimiter, async (req, res) => {
    const secret = generateTotpSecret();
    await pool.query(
      `INSERT INTO admin_mfa (user_id, secret, enabled, confirmed_at)
       VALUES ($1, $2, FALSE, NULL)
       ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, enabled = FALSE, confirmed_at = NULL`,
      [req.adminUserId, encryptTotpSecret(secret)]
    );
    const label = encodeURIComponent(`HanVerse:${req.adminUserId}`);
    ok(res, {
      secret,
      otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=HanVerse&digits=6&period=30`
    });
  });

  router.post('/admin/mfa/confirm', verifyAdminToken, writeLimiter, async (req, res) => {
    const code = req.body && req.body.code;
    const r = await pool.query('SELECT secret, enabled FROM admin_mfa WHERE user_id = $1', [req.adminUserId]);
    if (!r.rowCount) return fail(res, 400, 'Start enrolment first.');
    if (r.rows[0].enabled) return ok(res, { alreadyEnabled: true });
    if (!verifyTotp(decryptTotpSecret(r.rows[0].secret), code)) {
      await logSecurityEvent(pool, 'mfa_confirm_failed', req.adminUserId, req, 'bad code');
      return fail(res, 400, 'That code is not valid. Check your authenticator and try again.');
    }
    await pool.query(
      'UPDATE admin_mfa SET enabled = TRUE, confirmed_at = NOW() WHERE user_id = $1',
      [req.adminUserId]
    );
    await logSecurityEvent(pool, 'mfa_enabled', req.adminUserId, req, null);
    ok(res, { enabled: true });
  });

  /* ── Audit summary ────────────────────────────────────── */
  router.get('/admin/compliance/summary', verifyAdminToken, async (_req, res) => {
    const [consents, pendingDeletions, events, mfa] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM consent_records WHERE withdrawn_at IS NULL'),
      pool.query(`SELECT COUNT(*)::int AS n FROM deletion_requests WHERE status = 'pending'`),
      pool.query(`SELECT event_type, COUNT(*)::int AS n FROM security_events
                   WHERE created_at > NOW() - interval '7 days' GROUP BY event_type ORDER BY n DESC`),
      pool.query('SELECT COUNT(*)::int AS n FROM admin_mfa WHERE enabled = TRUE')
    ]);
    ok(res, {
      activeConsents: consents.rows[0].n,
      pendingDeletionRequests: pendingDeletions.rows[0].n,
      securityEvents7d: events.rows,
      adminsWithMfa: mfa.rows[0].n
    });
  });
}
