/* =========================================================
   NETLIFY SCHEDULED FUNCTION — trial expiry sweep ⏰
   Runs hourly; clears is_premium once a 7-day trial has
   lapsed. Only touches trial premium — Stripe premium lives
   in the separate `premium`/`premium_until` columns.
   Configured via `export const config` (Netlify v2 runtime).
   ========================================================= */
import pg from 'pg';

export const config = {
  schedule: '@hourly'
};

export default async () => {
  const connectionString =
    process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;

  if (!connectionString) {
    console.error('⏰ trial-sweep: no DATABASE_URL configured');
    return new Response(JSON.stringify({ success: false, error: 'no database url' }), { status: 500 });
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const sweep = await pool.query(
      `UPDATE users SET is_premium = FALSE, updated_at = NOW()
       WHERE is_premium = TRUE AND trial_used = TRUE
         AND trial_ends_at IS NOT NULL AND trial_ends_at < NOW()`
    );
    console.log(`⏰ trial-sweep: expired premium for ${sweep.rowCount} user(s)`);
    return new Response(JSON.stringify({ success: true, expired: sweep.rowCount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error('⏰ trial-sweep failed:', e.message);
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
  } finally {
    await pool.end();
  }
};
