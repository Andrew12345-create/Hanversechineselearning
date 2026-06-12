const { Pool } = require('pg');

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl: {
rejectUnauthorized: false
}
});

exports.handler = async (event) => {

if (event.httpMethod !== 'POST') {

```
return {
  statusCode: 405,
  body: JSON.stringify({
    premium: false,
    error: 'Method not allowed'
  })
};
```

}

try {

```
const { userId } =
  JSON.parse(event.body);

if (!userId) {

  return {
    statusCode: 400,
    body: JSON.stringify({
      premium: false,
      error: 'Missing userId'
    })
  };

}

const result =
  await pool.query(
    `
    SELECT premium
    FROM users
    WHERE user_id = $1
    `,
    [userId]
  );

if (result.rows.length === 0) {

  return {
    statusCode: 404,
    body: JSON.stringify({
      premium: false,
      error: 'User not found'
    })
  };

}

return {
  statusCode: 200,
  body: JSON.stringify({
    premium:
      result.rows[0].premium === true
  })
};
```

}
catch(error){

```
console.error(
  'Check premium error:',
  error
);

return {
  statusCode: 500,
  body: JSON.stringify({
    premium: false,
    error: error.message
  })
};
```

}

};
