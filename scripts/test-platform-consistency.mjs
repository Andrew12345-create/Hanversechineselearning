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
