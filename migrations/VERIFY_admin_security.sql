-- Read-only verification for the HanVerse Admin security migration.
-- Run this in the SAME Neon database selected by the deployed app's DATABASE_URL.
-- Every row in the first result should show present = true.
SELECT expected.table_name,
       (actual.table_name IS NOT NULL) AS present
FROM (VALUES
  ('admin_roles'),
  ('admin_elevated_sessions'),
  ('admin_auth_attempts'),
  ('admin_audit')
) AS expected(table_name)
LEFT JOIN information_schema.tables actual
  ON actual.table_schema = current_schema()
 AND actual.table_name = expected.table_name
ORDER BY expected.table_name;

-- Every row in the second result should show present = true.
WITH expected(table_name, column_name) AS (
  SELECT * FROM (VALUES
    ('users','admin_role'),
    ('admin_roles','role_key'), ('admin_roles','permissions'),
    ('admin_elevated_sessions','jti'), ('admin_elevated_sessions','user_id'),
    ('admin_elevated_sessions','expires_at'), ('admin_elevated_sessions','reauthenticated_at'),
    ('admin_elevated_sessions','revoked_at'),
    ('admin_auth_attempts','scope'), ('admin_auth_attempts','key_hash'),
    ('admin_auth_attempts','window_started_at'), ('admin_auth_attempts','attempts'),
    ('admin_auth_attempts','locked_until'),
    ('admin_audit','event_id'), ('admin_audit','actor_id'), ('admin_audit','actor_label'),
    ('admin_audit','action'), ('admin_audit','category'), ('admin_audit','target_type'),
    ('admin_audit','target_id'), ('admin_audit','reason'), ('admin_audit','outcome'),
    ('admin_audit','before_safe'), ('admin_audit','after_safe'), ('admin_audit','detail'),
    ('admin_audit','ip'), ('admin_audit','created_at')
  ) AS required(table_name, column_name)
)
SELECT expected.table_name, expected.column_name,
       (actual.column_name IS NOT NULL) AS present
FROM expected
LEFT JOIN information_schema.columns actual
  ON actual.table_schema = current_schema()
 AND actual.table_name = expected.table_name
 AND actual.column_name = expected.column_name
ORDER BY expected.table_name, expected.column_name;

-- Existing administrators should have received the super_admin role.
SELECT COUNT(*) FILTER (WHERE admin_role = 'super_admin') AS super_admins,
       COUNT(*) FILTER (WHERE admin_role IS NULL) AS admins_missing_role
FROM users
WHERE is_admin = TRUE;
