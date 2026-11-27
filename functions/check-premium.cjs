const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { ensurePaymentSchema } = require('../lib/payment-schema.cjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: true }
});

function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(data)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method not allowed' });
  }

  if (!process.env.JWT_SECRET) {
    return json(503, { success: false, error: 'Membership service is not configured.' });
  }

  const headers = event.headers || {};
  const authHeader = headers.authorization || headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return json(401, { success: false, error: 'Sign in required.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return json(401, { success: false, error: 'Session expired. Please sign in again.' });
  }

  const userId = decoded && (decoded.user_id || decoded.id);
  if (!userId || !Number.isInteger(Number(userId))) {
    return json(401, { success: false, error: 'Invalid session.' });
  }

  try {
    await ensurePaymentSchema(pool);
    const result = await pool.query(
      `SELECT user_id, premium, premium_until, membership_plan, membership_status,
              trial_ends_at, trial_used
         FROM users
        WHERE user_id = $1
        LIMIT 1`,
      [Number(userId)]
    );
    if (!result.rows.length) return json(404, { success: false, error: 'User not found.' });
    if (result.rows[0].is_banned) return json(403, { success: false, error: 'This account is banned.' });
    if (Number(decoded.tv || 0) !== Number(result.rows[0].token_version || 0)) {
      return json(401, { success: false, error: 'Session revoked. Please sign in again.' });
    }

    const { computeEntitlement } = await import('./entitlements.js');
    const entitlement = computeEntitlement(result.rows[0]);
    const plan = entitlement.plan === 'trial' ? 'premium' : entitlement.plan;

    return json(200, {
      success: true,
      premium: entitlement.active === true && entitlement.rank >= 2,
      membership_plan: plan,
      membership_status: entitlement.status,
      premium_until: entitlement.trialActive
        ? result.rows[0].trial_ends_at
        : result.rows[0].premium_until || null,
      trial_active: entitlement.trialActive === true,
      trial_ends_at: result.rows[0].trial_ends_at || null
    });
  } catch (error) {
    console.error('HanVerse membership check error:', error.message);
    return json(500, { success: false, error: 'Unable to check membership status.' });
  }
};
