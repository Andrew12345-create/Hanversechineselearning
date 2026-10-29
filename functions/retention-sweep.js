/* =========================================================
   NETLIFY SCHEDULED FUNCTION — retention sweep ⏰
   Runs daily; enforces the retention promises in privacy.html:
   accounts unused for 24 months are deleted along with their
   learning data. Configured via `export const config`
   (Netlify v2 runtime).
   ========================================================= */
import pg from 'pg';

export const config = {
  schedule: '@daily'
};

export default async () => {
  const connectionString =
    process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;

  if (!connectionString) {
    console.error('⏰ retention-sweep: no DATABASE_URL configured');
    return new Response(JSON.stringify({ success: false, error: 'no database url' }), { status: 500 });
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: true }
  });

  try {
    // Stale accounts: no activity in 24 months. Admins are never swept.
    const stale = await pool.query(
      `SELECT user_id FROM users
        WHERE COALESCE(last_active, created_at, updated_at) < NOW() - INTERVAL '24 months'
          AND (is_admin IS NOT TRUE AND role <> 'admin')`
    );
    if (!stale.rows.length) {
      console.log('⏰ retention-sweep: nothing to delete');
      return new Response(JSON.stringify({ success: true, deletedUsers: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const ids = stale.rows.map(r => r.user_id);
    // Learning + family data first, then the account (no FK surprises).
    await pool.query(`DELETE FROM xp_logs WHERE user_id = ANY($1::int[])`, [ids]);
    await pool.query(`DELETE FROM user_progress WHERE user_id = ANY($1::int[])`, [ids]);
    await pool.query(`DELETE FROM notifications WHERE user_id = ANY($1::int[])`, [ids]);
    await pool.query(`DELETE FROM parent_messages WHERE child_user_id = ANY($1::int[]) OR parent_user_id = ANY($1::int[])`, [ids]);
    await pool.query(`DELETE FROM account_links WHERE child_user_id = ANY($1::int[]) OR parent_user_id = ANY($1::int[])`, [ids]);
    await pool.query(`DELETE FROM children WHERE user_id = ANY($1::int[])`, [ids]);
    await pool.query(`DELETE FROM children WHERE parent_id IN (SELECT parent_id FROM parents WHERE user_id = ANY($1::int[]))`, [ids]);
    await pool.query(`DELETE FROM parents WHERE user_id = ANY($1::int[])`, [ids]);
    const del = await pool.query(
      `DELETE FROM users WHERE user_id = ANY($1::int[]) RETURNING user_id`,
      [ids]
    );
    console.log(`⏰ retention-sweep: deleted ${del.rowCount} stale account(s)`);
    return new Response(JSON.stringify({ success: true, deletedUsers: del.rowCount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error('⏰ retention-sweep failed:', e.message);
    return new Response(JSON.stringify({ success: false, error: 'sweep failed' }), { status: 500 });
  } finally {
    await pool.end();
  }
};
