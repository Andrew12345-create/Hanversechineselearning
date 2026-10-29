/* =========================================================
   NETLIFY SCHEDULED FUNCTION — weekly league rotation 🏆
   Runs hourly; closes the previous week exactly once (guarded
   by ON CONFLICT DO NOTHING on the current week's rows):
   top 5 promote, bottom 5 demote, clamped to [bronze, diamond].
   ========================================================= */
import pg from 'pg';

export const config = {
  schedule: '@hourly'
};

const TIERS = ['bronze', 'silver', 'gold', 'sapphire', 'diamond'];
const PROMOTE = 5;
const DEMOTE = 5;

const weekStartOf = (d = new Date()) => {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff))
    .toISOString().slice(0, 10);
};

export default async () => {
  const connectionString =
    process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;

  if (!connectionString) {
    console.error('🏆 league-rotate: no DATABASE_URL configured');
    return new Response(JSON.stringify({ success: false, error: 'no database url' }), { status: 500 });
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: true }
  });

  try {
    const thisWeek = weekStartOf();
    const lastWeek = weekStartOf(new Date(Date.now() - 7 * 86400000));
    if (lastWeek >= thisWeek) {
      return new Response(JSON.stringify({ success: true, skipped: 'same week' }), { status: 200 });
    }

    // Members of last week's leagues with their final weekly XP
    const { rows: members } = await pool.query(
      `SELECT l.user_id, l.league,
              COALESCE(SUM(x.amount), 0) AS weekly_xp
       FROM leagues l
       LEFT JOIN xp_logs x ON x.user_id = l.user_id
         AND x.timestamp >= $1::date AND x.timestamp < $2::date
       WHERE l.week_start = $1::date
       GROUP BY l.user_id, l.league
       ORDER BY l.league, weekly_xp DESC, l.user_id ASC`,
      [lastWeek, thisWeek]
    );

    // Group by league, then compute promote/demote bands
    const byLeague = {};
    for (const m of members) {
      (byLeague[m.league] ||= []).push(m);
    }

    let promoted = 0, demoted = 0, stayed = 0;
    for (const [league, list] of Object.entries(byLeague)) {
      const idx = TIERS.indexOf(league);
      list.forEach((m, i) => {
        let next = league;
        if (i < PROMOTE && idx < TIERS.length - 1) next = TIERS[idx + 1];
        else if (i >= list.length - DEMOTE && idx > 0) next = TIERS[idx - 1];
        if (next !== league) next === TIERS[idx + 1] ? promoted++ : demoted++;
        else stayed++;
        pool.query(
          `INSERT INTO leagues (user_id, week_start, league) VALUES ($1,$2,$3)
           ON CONFLICT (user_id, week_start) DO NOTHING`,
          [m.user_id, thisWeek, next]
        ).catch(() => {});
      });
    }

    console.log(`🏆 league-rotate (${lastWeek} → ${thisWeek}): ${members.length} members, +${promoted} promoted, -${demoted} demoted`);
    return new Response(JSON.stringify({
      success: true, week: thisWeek, members: members.length, promoted, demoted
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('🏆 league-rotate failed:', e.message);
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
  } finally {
    await pool.end();
  }
};
