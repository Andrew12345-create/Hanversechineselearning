import fs from 'node:fs';
import vm from 'node:vm';

const server = fs.readFileSync(new URL('../functions/server.js', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const netlify = fs.readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/2026110501_admin_security.sql', import.meta.url), 'utf8');
const elevationRoute = server.slice(server.indexOf("router.post('/admin/verify-password'"), server.indexOf("router.get('/admin/session'"));
const usersRoute = server.slice(server.indexOf("router.get('/admin/overview'"), server.indexOf("router.get('/admin/analytics'"));
let failed = 0;
function test(name, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
  if (!condition) failed++;
}

test('elevation requires a normal authenticated user session', /router\.post\('\/admin\/verify-password',[\s\S]{0,600}requireUser\(req, res\)/.test(server));
test('elevation identity comes from authenticated session, not request body', /SELECT user_id, username, full_name, email, password_hash, is_admin, is_banned[\s\S]{0,100}WHERE user_id = \$1[\s\S]{0,50}\[auth\.user_id\]/.test(server) && !/const \{\s*userId,\s*adminPassword\s*\}\s*=\s*req\.body/.test(server));
test('elevation returns generic credential failure', /Administrator verification failed\./.test(elevationRoute) && !/User not found\.|Invalid admin password\.|Access denied\. Administrator permissions/.test(elevationRoute));
test('Admin elevation checks all security schema before writing attempt records and explains missing migration', /ADMIN_MIGRATION_REQUIRED/.test(elevationRoute) && /await ensureAdminTables\(\);[\s\S]{0,100}recordAdminPasswordAttempt/.test(elevationRoute));
test('durable per-account and per-IP attempt throttles exist', /admin_auth_attempts/.test(server) && /admin-account:/.test(server) && /admin-ip:/.test(server));
test('elevated access is a short HttpOnly Secure SameSite cookie', /ADMIN_SESSION_TTL_SECONDS = 15 \* 60/.test(server) && /HttpOnly; Secure; SameSite=Strict/.test(server));
test('privileged requests require a live database-backed elevated session', /admin_elevated_sessions[\s\S]{0,350}revoked_at IS NULL[\s\S]{0,150}u\.is_admin = TRUE/.test(server));
test('elevated JWT verifies issuer and audience claims', /jwt\.verify\(token, process\.env\.JWT_SECRET, \{ issuer: 'hanverse', audience: 'hanverse-admin' \}\)/.test(server));
test('backend permission checks use database roles', /admin_roles r ON r\.role_key = u\.admin_role/.test(server) && /permissions\.includes\(permission\)/.test(server));
test('feature-pack parent digest send has explicit communication permission and reauthentication', /path === '\/parents\/digest\/send'\) return 'communications\.manage'/.test(server) && /path === '\/parents\/digest\/send' \|\|/.test(server));
test('individual support email requires recent reauthentication and validates headers/body size', server.includes('users\\/(ban|delete|update|email)') && /cleanSubject\.length > 180/.test(server) && /cleanMessage\.length > 10000/.test(server));
test('destructive operations require recent password reauthentication', /ADMIN_REAUTH_REQUIRED/.test(server) && /reauthenticated_at/.test(server));
test('user listing is paginated and selects safe fields', /LIMIT \$[\s\S]{0,100}OFFSET \$/.test(usersRoute) && /SELECT user_id, username, full_name, email/.test(usersRoute) && !/SELECT \* FROM users/.test(usersRoute));
test('parent lists minimize fields and are bounded', /p\.parent_id, p\.user_id, p\.full_name, p\.email, p\.is_verified, p\.is_active/.test(server) && /LIMIT 250/.test(server) && /LIMIT 100/.test(server) && !/SELECT p\.\*, u\.username/.test(server));
test('account deletion prevents self/admin deletion and records measured impact', /You cannot delete your own administrator account/.test(server) && /Administrator accounts require a separate staff-access workflow/.test(server) && /accountDeletionImpact/.test(server));
test('ban flow blocks self-suspension and audits in the mutation transaction', /You cannot suspend your own account/.test(server) && /insertAdminAudit\(client, req, banned \? 'user\.suspend'/.test(server));
test('email campaigns require promotional opt-in and unsubscribe eligibility', /user_communication_preferences pref[\s\S]{0,180}promotional_opt_in = TRUE AND pref\.promotional_unsubscribed_at IS NULL/.test(server));
test('migration preserves admins and creates revocable sessions and role permissions', /UPDATE users SET admin_role = 'super_admin'[\s\S]{0,80}WHERE is_admin = TRUE/.test(migration) && /CREATE TABLE IF NOT EXISTS admin_elevated_sessions/.test(migration) && /CREATE TABLE IF NOT EXISTS admin_roles/.test(migration));
test('runtime bootstrap requires the additive migration rather than creating a legacy audit table', /Admin security migration required: apply migrations\/2026110501_admin_security\.sql/.test(server) && !/CREATE TABLE IF NOT EXISTS admin_audit \([\s\S]{0,160}actor_id INTEGER,[\s\S]{0,160}action TEXT NOT NULL/.test(server));
test('queued campaign processor rechecks current promotional consent', /UPDATE email_campaign_recipients r[\s\S]{0,450}status = 'skipped'[\s\S]{0,380}promotional_unsubscribed_at IS NULL/.test(server));
test('Panda admin assistant is instructed to identify missing metrics and separate hypotheses', /If a value is '\?', say the source is unavailable[\s\S]{0,300}Clearly label hypotheses/.test(server));
test('browser does not persist privileged bearer tokens', !/hanverse_admin_token|localStorage\.setItem\([^\n]*adminToken|state\.token/.test(admin));
test('Admin sign-in obtains normal session then elevates in memory', /fetch\(`\$\{API\}\/login`/.test(admin) && /Authorization: `Bearer \$\{normalSessionToken\}`/.test(admin) && /normalSessionToken = null/.test(admin));
test('browser uses same-origin cookies for Admin API calls', /credentials: "same-origin"/.test(admin) && /\/admin\/session/.test(admin));
test('Admin migration error preserves its machine-readable code for helpful recovery guidance', /code: data\.code \|\| null/.test(admin) && /error\.code === "ADMIN_MIGRATION_REQUIRED"/.test(admin));
test('Admin migration recovery explains the correct Neon database and links the reviewed SQL file', /Open the Neon project connected to this HanVerse deployment/.test(admin) && /migrations\/2026110501_admin_security\.sql/.test(admin) && /SQL Editor/.test(admin));
test('Admin migration recovery is announced accessibly', /id="authError" class="error" role="alert" aria-live="assertive"/.test(admin));
test('legacy audit migration repairs missing required columns without dropping history', /ADD COLUMN IF NOT EXISTS actor_id INTEGER/.test(migration) && /ADD COLUMN IF NOT EXISTS actor_label TEXT/.test(migration) && /ADD COLUMN IF NOT EXISTS action TEXT/.test(migration) && /ADD COLUMN IF NOT EXISTS detail TEXT/.test(migration) && /ADD COLUMN IF NOT EXISTS ip TEXT/.test(migration) && /ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ/.test(migration));
test('Admin Studio includes premium responsive and keyboard-focus polish', /Premium Admin Studio finish/.test(admin) && /:focus-visible/.test(admin) && /prefers-reduced-motion:reduce/.test(admin));
test('dashboard panel startup cannot present a successful sign-in as a failed login', /async function loadAdminWorkspace\(\)[\s\S]{0,220}Promise\.allSettled/.test(admin) && (admin.match(/await loadAdminWorkspace\(\)/g) || []).length === 2 && /finally \{[\s\S]{0,100}\$\("adminPassword"\)\.value = ""/.test(admin));
test('Admin delete UI reads actual impact and requires typed confirmation', /\/admin\/users\/\$\{encodeURIComponent\(id\)\}\/impact/.test(admin) && /Type the account username exactly/.test(admin));
test('Admin routes are served by this repository, not redirected away', !/from = "\/admin\.html"[\s\S]{0,120}https:\/\/learn-hanverse\.netlify\.app/.test(netlify) && /from = "\/admin"[\s\S]{0,80}to = "\/admin\.html"/.test(netlify));

const inlineScripts = [...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(code => code.trim());
for (let i = 0; i < inlineScripts.length; i++) {
  try { new vm.Script(inlineScripts[i], { filename: `admin-inline-${i + 1}.js` }); test(`Admin inline JavaScript parses (${i + 1})`, true); }
  catch (error) { test(`Admin inline JavaScript parses (${i + 1}): ${error.message}`, false); }
}

test('operations command centre renders live database, API, email and backup telemetry', /id="opsServiceGrid"/.test(admin) && /function renderOpsCentre\(data\)/.test(admin) && /services\.database/.test(admin) && /services\.api/.test(admin) && /services\.email/.test(admin) && /services\.backup/.test(admin));
test('operations panel distinguishes unknown telemetry from healthy services', /Unknown · telemetry unavailable/.test(admin) && /Available · not a health probe/.test(admin) && /No verified backup telemetry is configured/.test(admin));
test('operations alert content is HTML-escaped before rendering', /escapeHTML\(alert\.title\)/.test(admin) && /escapeHTML\(alert\.detail\)/.test(admin) && /escapeHTML\(title\)/.test(admin));
test('topbar exposes an accessible command palette button', /id="cmdkTopButton"/.test(admin) && /aria-label="Search and navigate"/.test(admin) && /addEventListener\("click", cmdkOpen\)/.test(admin));

console.log(`\n${failed ? `${failed} failure(s)` : 'All Admin security checks passed'}`);
process.exitCode = failed ? 1 : 0;
