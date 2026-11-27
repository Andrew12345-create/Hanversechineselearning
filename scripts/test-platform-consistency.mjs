import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const server = read('functions/server.js');
const checkout = read('functions/create-checkout-session.cjs');
const webhook = read('functions/stripe-webhook.cjs');
const paymentSchema = read('functions/payment-schema.cjs');
const baseSchema = read('database_schema.sql');
const compliance = read('functions/compliance.js');
const admin = read('admin.html');

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
