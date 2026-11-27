/* Contract and unit checks for the compliance module.
   Run: node scripts/test-compliance.mjs */
import { readFileSync } from 'node:fs';
import {
  base32Encode, base32Decode, totpCode, verifyTotp, generateTotpSecret,
  encryptTotpSecret, decryptTotpSecret,
  CONSENT_PURPOSES, OPTIONAL_PURPOSES, RETENTION_SCHEDULE
} from '../functions/compliance.js';

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    passed++;
    console.log(`✅ ${name}`);
  } else {
    failed++;
    console.log(`❌ ${name}`);
  }
}

const server = readFileSync(new URL('../functions/server.js', import.meta.url), 'utf8');
const mod = readFileSync(new URL('../functions/compliance.js', import.meta.url), 'utf8');

console.log('▶ TOTP');

const secret = generateTotpSecret();
test('generated secret is base32 and 32 chars', /^[A-Z2-7]{32}$/.test(secret));
test('base32 round-trips random bytes', (() => {
  const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22]);
  return base32Decode(base32Encode(buf)).equals(buf);
})());
test('current code verifies', verifyTotp(secret, totpCode(secret)));
test('code from the previous step verifies (clock drift)', (() => {
  const step = Math.floor(Date.now() / 30000) - 1;
  return verifyTotp(secret, totpCode(secret, step));
})());
test('code from two steps ago is rejected', (() => {
  const step = Math.floor(Date.now() / 30000) - 2;
  return !verifyTotp(secret, totpCode(secret, step));
})());
test('wrong code is rejected', !verifyTotp(secret, '000000') || totpCode(secret) === '000000');
test('non-numeric code is rejected', !verifyTotp(secret, 'abcdef'));
test('short code is rejected', !verifyTotp(secret, '12345'));
test('a different secret does not verify', !verifyTotp(generateTotpSecret(), totpCode(secret)));
test('MFA seeds are encrypted at rest and decrypt for TOTP verification', (() => {
  const previous = process.env.ADMIN_MFA_ENCRYPTION_KEY;
  process.env.ADMIN_MFA_ENCRYPTION_KEY = 'test-only-mfa-encryption-key-with-enough-entropy';
  try {
    const encrypted = encryptTotpSecret(secret);
    return encrypted.startsWith('enc:v1:')
      && !encrypted.includes(secret)
      && decryptTotpSecret(encrypted) === secret
      && decryptTotpSecret(secret) === secret;
  } finally {
    if (previous === undefined) delete process.env.ADMIN_MFA_ENCRYPTION_KEY;
    else process.env.ADMIN_MFA_ENCRYPTION_KEY = previous;
  }
})());

console.log('▶ Consent model');

test('core service consent is listed', CONSENT_PURPOSES.includes('core_service'));
test('optional purposes exclude core service', !OPTIONAL_PURPOSES.includes('core_service'));
test('media and AI purposes are separately grantable', ['photographs', 'audio_recording', 'ai_tutor', 'marketing_email'].every(p => OPTIONAL_PURPOSES.includes(p)));
test('consent table records purpose and policy version', /CREATE TABLE IF NOT EXISTS consent_records[\s\S]{0,600}purpose VARCHAR\(40\) NOT NULL[\s\S]{0,200}policy_version VARCHAR\(20\) NOT NULL/.test(mod));
test('consent withdrawal is a timestamp, not a delete', /UPDATE consent_records SET withdrawn_at = NOW\(\)/.test(mod) && !/DELETE FROM consent_records/.test(mod));
test('core service consent cannot be withdrawn', /core_service' && granted === false/.test(mod) && /core_service'\) \{\s*return fail\(res, 400, 'The core service consent cannot be withdrawn/.test(mod));
test('consent writes are rate limited', /router\.post\('\/compliance\/consents', requireAuth, writeLimiter/.test(mod));

console.log('▶ Subject resolution');

test('guardian link follows the verified children → parents → user relationship', /JOIN parents p ON p\.parent_id = c\.parent_id/.test(mod) && /p\.user_id = \$2/.test(mod) && /COALESCE\(p\.is_verified, FALSE\) = TRUE/.test(mod));
test('unlinked subject is refused with 403', /You cannot change consent for that account/.test(mod));
test('client-supplied subject is never trusted alone', /resolveSubject\(pool, auth, req\.body\.subject\)/.test(mod) && /guardianOwnsChild\(db, self, target\)/.test(mod));

console.log('▶ Deletion requests');

test('deletion_requests table exists', /CREATE TABLE IF NOT EXISTS deletion_requests/.test(mod));
test('duplicate pending request is not created twice', /alreadyPending: true/.test(mod));
test('admin list is admin-authenticated', /router\.get\('\/admin\/compliance\/deletion-requests', verifyAdminToken/.test(mod));
test('admin resolve is admin-authenticated and limited', /router\.patch\('\/admin\/compliance\/deletion-requests\/:id', verifyAdminToken, writeLimiter/.test(mod));
test('resolve records who acted', /resolved_by = \$3/.test(mod));

console.log('▶ Retention');

test('schedule covers every purgeable table', Object.keys({ security_events: 1, notifications: 1, game_sessions: 1, ai_usage_daily: 1 }).every(t => RETENTION_SCHEDULE.some(r => r.category === t)));
test('purge is dry-run unless confirm is true', /dryRun: !confirm/.test(mod) && /req\.body\.confirm === true/.test(mod));
test('purge only touches an allow-list', /const PURGEABLE = \{/.test(mod) && /for \(const \[table, column\] of Object\.entries\(PURGEABLE\)\)/.test(mod) && /ai_usage_daily: 'usage_date'/.test(mod));
test('no DROP or TRUNCATE anywhere in the module', !/\b(DROP TABLE|TRUNCATE)\b/i.test(mod));

console.log('▶ Session revocation');

test('users gain a token_version column', /ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0/.test(mod));
test('logout-all bumps the version', /SET token_version = COALESCE\(token_version, 0\) \+ 1/.test(mod));
test('requireUser rejects a stale token version', /tokenVersion !== Number\(user\.token_version \|\| 0\)/.test(server) && /Session revoked/.test(server));
test('requireUser selects token_version', /COALESCE\(token_version, 0\) AS token_version/.test(server));
test('every newly issued JWT carries the current token_version', /jwt\.sign\(\{ \.\.\.payload, tv: tokenVersion \}/.test(server) && /tv: user\.token_version \|\| 0/.test(server));
test('session refresh rejects revoked tokens and reloads the current token version', /decoded\.tv \|\| 0\) !== Number\(result\.rows\[0\]\.token_version \|\| 0/.test(server) && /trial_ends_at, trial_used, token_version/.test(server));
test('logout-all also revokes elevated administrator sessions', /u\.token_version, u\.admin_role/.test(server) && /decoded\.tv \|\| 0\) !== Number\(user\.token_version \|\| 0/.test(server) && /UPDATE admin_elevated_sessions SET revoked_at = NOW\(\)/.test(server));

console.log('▶ Admin MFA');

test('MFA enrolment is admin-authenticated', /router\.post\('\/admin\/mfa\/enroll', verifyAdminToken, writeLimiter/.test(mod));
test('MFA confirm is admin-authenticated', /router\.post\('\/admin\/mfa\/confirm', verifyAdminToken, writeLimiter/.test(mod));
test('MFA secret is stored per admin user and encrypted at rest', /CREATE TABLE IF NOT EXISTS admin_mfa[\s\S]{0,200}user_id INTEGER PRIMARY KEY/.test(mod) && /encryptTotpSecret\(secret\)/.test(mod) && /decryptTotpSecret\(r\.rows\[0\]\.secret\)/.test(mod));
test('failed MFA confirmation is logged', /mfa_confirm_failed/.test(mod));
test('enrolment returns an otpauth URI', /otpauth:\/\/totp\//.test(mod));

console.log('▶ Wiring');

test('compliance routes are mounted', /registerComplianceRoutes\(router, pool, \{ requireUser, verifyAdminToken \}\)/.test(server));
test('compliance schema converges at boot', /ensureComplianceSchema\(pool\)/.test(server));
test('module refuses to mount without authenticators', /typeof requireUser !== 'function'/.test(mod) || /requireUser, verifyAdminToken \} = deps/.test(mod));

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed) {
  console.log(`\n❌ ${failed} failure(s)`);
  process.exit(1);
}
