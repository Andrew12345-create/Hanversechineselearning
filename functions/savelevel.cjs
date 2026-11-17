const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true
  }
});

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method Not Allowed' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return json(503, { success: false, error: 'Level service is not configured.' });
  }

  const headers = event.headers || {};
  const header = headers.authorization || headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return json(401, { success: false, error: 'Sign in required.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (error) {
    return json(401, { success: false, error: 'Session expired — please sign in again.' });
  }

  const userId = decoded && (decoded.user_id || decoded.id);
  if (!userId) {
    return json(401, { success: false, error: 'Session expired — please sign in again.' });
  }

  try {
    const { level } = JSON.parse(event.body || '{}');

    if (!level || typeof level !== 'string' || level.length > 40) {
      return json(400, { success: false, error: 'A valid level is required.' });
    }

    const result = await pool.query(
      `UPDATE users SET chinese_level = $1 WHERE user_id = $2 RETURNING user_id, chinese_level`,
      [level, userId]
    );

    if (!result.rows.length) {
      return json(404, { success: false, error: 'User not found.' });
    }

    return json(200, { success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Save level error:', error.message);
    return json(500, { success: false, error: 'Could not save your level.' });
  }
};
