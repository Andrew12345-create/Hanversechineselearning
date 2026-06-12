const { Pool } = require('pg');

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl: {
rejectUnauthorized: false
}
});

exports.handler = async (event) => {

if (event.httpMethod !== 'POST') {
return {
statusCode: 405,
body: JSON.stringify({
error: 'Method Not Allowed'
})
};
}

try {

```
const { userId, level } =
  JSON.parse(event.body);

if (!userId || !level) {

  return {
    statusCode: 400,
    body: JSON.stringify({
      error: 'Missing userId or level'
    })
  };

}

const result = await pool.query(
  `
  UPDATE users
  SET chinese_level = $1
  WHERE user_id = $2
  RETURNING user_id, chinese_level
  `,
  [level, userId]
);

return {
  statusCode: 200,
  body: JSON.stringify({
    success: true,
    user: result.rows[0]
  })
};
```

} catch (error) {

```
console.error('Save level error:', error);

return {
  statusCode: 500,
  body: JSON.stringify({
    success: false,
    error: error.message
  })
};
```

}

};
