/* =========================================================
   NETLIFY SCHEDULED FUNCTION — account retention sweep
   Daily candidate scan for accounts inactive for 24 months.

   Safety defaults:
   - Disabled unless RETENTION_SWEEP_ENABLED=true.
   - Dry-run unless RETENTION_SWEEP_DRY_RUN=false.
   - Destructive mode additionally requires
     RETENTION_SWEEP_CONFIRM=DELETE_STALE_ACCOUNTS.
   - Processes a bounded batch and uses one transaction so a
     missing FK cleanup table cannot leave a partially deleted account.
   ========================================================= */
import pg from 'pg';

export const config = { schedule: '@daily' };

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

function batchLimit() {
  const parsed = Number.parseInt(process.env.RETENTION_SWEEP_MAX_USERS || '100', 10);
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, parsed)) : 100;
}

export default async () => {
  if (process.env.RETENTION_SWEEP_ENABLED !== 'true') {
    console.info('retention-sweep: disabled; set RETENTION_SWEEP_ENABLED=true to activate candidate scans');
    return json({ success: true, status: 'disabled', dryRun: true, candidates: null });
  }

  const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    console.error('retention-sweep: database URL is not configured');
    return json({ success: false, error: 'database is not configured' }, 500);
  }

  const dryRun = process.env.RETENTION_SWEEP_DRY_RUN !== 'false';
  if (!dryRun && process.env.RETENTION_SWEEP_CONFIRM !== 'DELETE_STALE_ACCOUNTS') {
    console.error('retention-sweep: destructive mode blocked; explicit confirmation is missing');
    return json({ success: false, error: 'destructive confirmation is missing' }, 409);
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000
  });

  let client;
  try {
    client = await pool.connect();
    if (!dryRun) await client.query('BEGIN');

    const stale = await client.query(
      `SELECT user_id
         FROM users
        WHERE COALESCE(last_active, created_at, updated_at) < NOW() - INTERVAL '24 months'
          AND is_admin IS NOT TRUE
          AND COALESCE(role, '') <> 'admin'
        ORDER BY COALESCE(last_active, created_at, updated_at) ASC
        LIMIT $1
        ${dryRun ? '' : 'FOR UPDATE SKIP LOCKED'}`,
      [batchLimit()]
    );

    const ids = stale.rows.map(row => row.user_id);
    if (dryRun) {
      console.info(`retention-sweep: dry run found ${ids.length} candidate(s); no account data changed`);
      return json({
        success: true,
        status: 'dry-run',
        dryRun: true,
        candidates: ids.length,
        batchLimit: batchLimit(),
        moreMayRemain: ids.length === batchLimit()
      });
    }

    if (!ids.length) {
      await client.query('COMMIT');
      console.info('retention-sweep: no stale accounts eligible for deletion');
      return json({ success: true, status: 'complete', dryRun: false, deletedUsers: 0 });
    }

    // Keep all dependent-data cleanup and account deletion atomic.
    await client.query('DELETE FROM xp_logs WHERE user_id = ANY($1::int[])', [ids]);
    await client.query('DELETE FROM user_progress WHERE user_id = ANY($1::int[])', [ids]);
    await client.query('DELETE FROM notifications WHERE user_id = ANY($1::int[])', [ids]);
    await client.query(
      'DELETE FROM parent_messages WHERE child_user_id = ANY($1::int[]) OR parent_user_id = ANY($1::int[])',
      [ids]
    );
    await client.query(
      'DELETE FROM account_links WHERE child_user_id = ANY($1::int[]) OR parent_user_id = ANY($1::int[])',
      [ids]
    );
    await client.query('DELETE FROM children WHERE user_id = ANY($1::int[])', [ids]);
    await client.query(
      'DELETE FROM children WHERE parent_id IN (SELECT parent_id FROM parents WHERE user_id = ANY($1::int[]))',
      [ids]
    );
    await client.query('DELETE FROM parents WHERE user_id = ANY($1::int[])', [ids]);
    const deleted = await client.query(
      'DELETE FROM users WHERE user_id = ANY($1::int[]) RETURNING user_id',
      [ids]
    );

    await client.query('COMMIT');
    console.info(`retention-sweep: committed deletion of ${deleted.rowCount} stale account(s)`);
    return json({
      success: true,
      status: 'complete',
      dryRun: false,
      deletedUsers: deleted.rowCount,
      batchLimit: batchLimit(),
      moreMayRemain: deleted.rowCount === batchLimit()
    });
  } catch (error) {
    if (client && !dryRun) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    console.error('retention-sweep failed:', error.message);
    return json({ success: false, error: 'retention sweep failed; transaction rolled back where applicable' }, 500);
  } finally {
    client?.release();
    await pool.end();
  }
};
