import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const server = read('functions/server.js');
const checkout = read('functions/create-checkout-session.cjs');
const webhook = read('functions/stripe-webhook.cjs');
const paymentSchema = read('lib/payment-schema.cjs');
const baseSchema = read('database_schema.sql');
const compliance = read('functions/compliance.js');
const admin = read('admin.html');
const premiumCheck = read('functions/check-premium.cjs');
const paymentPage = read('payment.html');
const aiHelpers = read('functions/ai-helpers.js');
const aiRoutes = read('functions/ai-routes.js');

test('Panda uses the shared AI gateway and server startup does not require an OpenAI key', () => {
  assert.match(server, /import \{ underLimit, markUsage, aiChat \} from '\.\/ai-helpers\.js'/);
  assert.doesNotMatch(server, /new OpenAI\s*\(/);
  assert.doesNotMatch(server, /openai\.chat\.completions\.create/);
  assert.match(server, /const completion = await aiChat\(/);
});

test('core schema readiness gates API requests on cold starts', () => {
  assert.match(server, /let coreSchemaReady = Promise\.resolve\(\)/);
  assert.match(server, /coreSchemaReady\.then\(\(\) =>/);
  assert.match(server, /ensurePaymentSchema\(pool\)/);
  assert.match(server, /\.\.\/lib\/payment-schema\.cjs/);
});

test('membership and progress columns are converged for fresh and existing databases', () => {
  for (const column of ['membership_plan', 'membership_status', 'stripe_customer_id', 'stripe_subscription_id', 'is_premium']) {
    assert.match(server, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
    assert.match(baseSchema, new RegExp(`\\b${column}\\b`));
  }
  for (const column of ['xp_earned', 'time_spent']) {
    assert.match(server, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
    assert.match(baseSchema, new RegExp(`\\b${column}\\b`));
  }
});

test('checkout and webhook use one major-unit payment amount field', () => {
  assert.match(checkout, /ensurePaymentSchema\(pool\)/);
  assert.match(checkout, /\bamount,\s*currency,\s*status/);
  assert.match(webhook, /ensurePaymentSchema\(pool\)/);
  assert.match(webhook, /amount = EXCLUDED\.amount/);
  assert.doesNotMatch(webhook, /amount_cents/);
  assert.match(paymentSchema, /amount NUMERIC\(10,2\)/);
  assert.match(paymentSchema, /amount_cents::numeric \/ 100/);
});

test('checkout redirects use the canonical app URL instead of the retired hostname', () => {
  assert.match(checkout, /PUBLIC_SITE_URL \|\| process\.env\.URL \|\| 'https:\/\/learn-hanverse\.netlify\.app'/);
  assert.doesNotMatch(checkout, /https:\/\/hanverse\.netlify\.app/);
});

test('guardian authorization follows the documented parent-child foreign-key chain', () => {
  assert.match(compliance, /JOIN parents p ON p\.parent_id = c\.parent_id/);
  assert.match(compliance, /p\.user_id = \$2/);
  assert.doesNotMatch(compliance, /parent_user_id = \$2/);
});

test('enrolled administrators must complete TOTP before elevation', () => {
  assert.match(server, /SELECT secret, enabled FROM admin_mfa/);
  assert.match(server, /verifyTotp\(mfaResult\.rows\[0\]\.secret, mfaCode\)/);
  assert.match(server, /code: 'ADMIN_MFA_REQUIRED'/);
  assert.match(admin, /data\.code === "ADMIN_MFA_REQUIRED"/);
  assert.match(admin, /mfaCode: String\(code\)\.trim\(\)/);
});

test('fresh and existing databases receive the parent-child profile tables', () => {
  assert.match(server, /CREATE TABLE IF NOT EXISTS parents/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS children/);
  assert.match(baseSchema, /CREATE TABLE IF NOT EXISTS parents/);
  assert.match(baseSchema, /CREATE TABLE IF NOT EXISTS children/);
  assert.match(server, /ALTER TABLE children ADD COLUMN IF NOT EXISTS classroom_allowed/);
});

test('feature and dictionary endpoints wait for their own schema initialization', () => {
  assert.match(server, /featureSchemaReady = coreSchemaReady/);
  assert.match(server, /dictionarySchemaReady = coreSchemaReady/);
  assert.match(server, /if \(needsFeatureSchema\) waits\.push\(featureSchemaReady\)/);
  assert.match(server, /if \(needsDictionarySchema\) waits\.push\(dictionarySchemaReady\)/);
});

test('administrator dictionary endpoints have explicit content permissions', () => {
  assert.match(server, /path === '\/admin\/dictionary' \|\| path\.startsWith\('\/admin\/dictionary\/'\)/);
});

test('membership lookup derives identity from JWT and shares entitlement logic', () => {
  assert.match(premiumCheck, /jwt\.verify\(token, process\.env\.JWT_SECRET/);
  assert.match(premiumCheck, /await import\('\.\/entitlements\.js'\)/);
  assert.match(premiumCheck, /computeEntitlement\(result\.rows\[0\]\)/);
  assert.doesNotMatch(premiumCheck, /const \{\s*userId\s*\} = body/);
  assert.match(paymentPage, /Authorization': 'Bearer ' \+ stored\.token/);
});

test('standalone billing endpoints honor bans and logout-all token revocation', () => {
  assert.match(checkout, /COALESCE\(token_version, 0\) AS token_version/);
  assert.match(checkout, /Number\(decodedToken\.tv \|\| 0\) !== Number\(user\.token_version \|\| 0\)/);
  assert.match(checkout, /if \(user\.is_banned\)/);
  assert.match(premiumCheck, /Number\(decoded\.tv \|\| 0\) !== Number\(result\.rows\[0\]\.token_version \|\| 0\)/);
  assert.match(premiumCheck, /if \(result\.rows\[0\]\.is_banned\)/);
});

test('checkout blocks duplicate paid plans using the shared entitlement engine', () => {
  assert.match(checkout, /await import\('\.\/entitlements\.js'\)/);
  assert.match(checkout, /computeEntitlement\(user\)/);
  assert.match(checkout, /entitlement\.source !== 'trial'/);
});

test('admin MFA and compliance routes are permission-mapped and sensitive changes require reauthentication', () => {
  assert.match(server, /path === '\/admin\/mfa\/status'\) return 'session\.read'/);
  assert.match(server, /path === '\/admin\/mfa\/enroll' \|\| path === '\/admin\/mfa\/confirm'/);
  assert.match(server, /path === '\/admin\/compliance' \|\| path\.startsWith\('\/admin\/compliance\/'\)/);
  assert.match(server, /path === '\/admin\/mfa\/enroll'/);
  assert.match(server, /retention\\\/purge\|deletion-requests/);
});

test('CyberShield exposes administrator MFA enrollment and verification controls', () => {
  assert.match(admin, /id="adminMfaSetup"/);
  assert.match(admin, /id="adminMfaSecret"/);
  assert.match(admin, /id="adminMfaUri"/);
  assert.match(admin, /api\("\/admin\/mfa\/enroll"/);
  assert.match(admin, /api\("\/admin\/mfa\/confirm"/);
});

test('safe session profiles preserve the separate trial and Premium feature flag', () => {
  assert.match(server, /const entitlement = computeEntitlement\(user\)/);
  assert.match(server, /is_premium: premiumAccess/);
  assert.match(server, /trial_active: entitlement\.trialActive === true/);
});

test('AI daily limits are persistent and atomic across serverless instances', () => {
  assert.match(aiHelpers, /CREATE TABLE IF NOT EXISTS ai_usage_daily/);
  assert.match(aiHelpers, /ON CONFLICT \(user_id, usage_date, task\)/);
  assert.match(aiHelpers, /WHERE ai_usage_daily\.calls < \$3/);
  assert.match(aiHelpers, /export async function consumeAIUsage/);
  assert.match(aiHelpers, /export async function getAIUsage/);
  assert.match(aiRoutes, /consumeAIUsage\(pool, userId, 'lessonHelp'\)/);
  assert.match(aiRoutes, /consumeAIUsage\(pool, userId, 'quizExplain'\)/);
  assert.match(aiRoutes, /consumeAIUsage\(pool, userId, 'practice'\)/);
  assert.match(aiRoutes, /consumeAIUsage\(pool, req\.adminUserId, 'adminDraft'\)/);
  assert.doesNotMatch(aiRoutes, /underLimit\(/);
  assert.match(server, /consumeAIUsage\(pool, userId, 'pandaChat'\)/);
});
