-- HanVerse Admin security foundation. Apply manually before deploying the
-- corresponding server changes. This migration is additive and preserves
-- existing admin accounts and audit rows.
BEGIN;

CREATE TABLE IF NOT EXISTS admin_roles (
  role_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_admin_role_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_admin_role_fk
      FOREIGN KEY (admin_role) REFERENCES admin_roles(role_key) ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO admin_roles (role_key, label, permissions) VALUES
  ('support', 'Support', '["users.read","users.support","communications.read"]'::jsonb),
  ('parent_safety', 'Parent Safety Reviewer', '["parents.read","parents.review","safety.read","safety.manage"]'::jsonb),
  ('content_editor', 'Content Editor', '["content.read","content.edit"]'::jsonb),
  ('content_publisher', 'Content Publisher', '["content.read","content.edit","content.publish","content.delete"]'::jsonb),
  ('communications', 'Communications', '["communications.read","communications.manage"]'::jsonb),
  ('finance', 'Finance', '["finance.read","subscriptions.read"]'::jsonb),
  ('analyst', 'Analyst', '["analytics.read","users.read"]'::jsonb),
  ('moderator', 'Moderator', '["users.read","users.moderate","safety.read","safety.manage"]'::jsonb),
  ('super_admin', 'Super Admin', '["*"]'::jsonb)
ON CONFLICT (role_key) DO UPDATE SET label = EXCLUDED.label, permissions = EXCLUDED.permissions, updated_at = NOW();

UPDATE users SET admin_role = 'super_admin'
WHERE is_admin = TRUE AND admin_role IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_admin_role ON users(admin_role) WHERE is_admin = TRUE;

CREATE TABLE IF NOT EXISTS admin_elevated_sessions (
  jti UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  reauthenticated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  ip_hash TEXT,
  user_agent_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_expiry
  ON admin_elevated_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_auth_attempts (
  scope TEXT NOT NULL CHECK (scope IN ('account','ip')),
  key_hash TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, key_hash)
);
CREATE INDEX IF NOT EXISTS idx_admin_auth_attempts_lock ON admin_auth_attempts(locked_until);

CREATE TABLE IF NOT EXISTS admin_audit (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  actor_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  actor_label TEXT,
  action TEXT NOT NULL,
  category TEXT,
  target_type TEXT,
  target_id TEXT,
  reason TEXT,
  outcome TEXT NOT NULL DEFAULT 'success',
  before_safe JSONB,
  after_safe JSONB,
  detail TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS event_id UUID DEFAULT gen_random_uuid();
UPDATE admin_audit SET event_id = gen_random_uuid() WHERE event_id IS NULL;
ALTER TABLE admin_audit ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS target_type TEXT;
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS target_id TEXT;
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'success';
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS before_safe JSONB;
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS after_safe JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_audit_event_id ON admin_audit(event_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit(actor_id, created_at DESC);

-- Promotional mail is opt-in only. Existing accounts remain opted out until
-- affirmative consent has been collected and recorded.
CREATE TABLE IF NOT EXISTS user_communication_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  essential_email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  promotional_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  promotional_unsubscribed_at TIMESTAMPTZ,
  promotional_consent_at TIMESTAMPTZ,
  promotional_consent_source TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_comms_promotional
  ON user_communication_preferences(promotional_opt_in, promotional_unsubscribed_at);

COMMIT;

-- Rollback guidance: first inspect and export users.admin_role,
-- admin_elevated_sessions, and admin_auth_attempts if their history matters.
-- Revoke active elevated sessions before removing the feature. Do not drop
-- admin_roles while users still reference its keys. The application should
-- be rolled back before any manually approved table/column removal.
