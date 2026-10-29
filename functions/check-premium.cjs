const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true
  }
});


exports.handler = async (event) => {

  /*
  ============================================================
  HANVERSE MEMBERSHIP STATUS
  ============================================================
  Returns the user's actual membership information.

  Possible plans:

  free
  yct
  premium

  Possible statuses:

  active
  cancelled
  past_due
  expired
  incomplete
  ============================================================
  */


  /* ==========================================================
     METHOD CHECK
  ========================================================== */

  if (event.httpMethod !== 'POST') {

    return {
      statusCode: 405,

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        success: false,
        premium: false,
        membership_plan: 'free',
        membership_status: 'active',
        error: 'Method not allowed'
      })
    };

  }


  try {

    /* ========================================================
       PARSE REQUEST
    ======================================================== */

    let body;

    try {

      body =
        JSON.parse(
          event.body || '{}'
        );

    } catch (error) {

      return {
        statusCode: 400,

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          success: false,
          premium: false,
          membership_plan: 'free',
          membership_status: 'active',
          error: 'Invalid JSON request'
        })
      };

    }


    const {
      userId
    } = body;


    /* ========================================================
       USER ID REQUIRED
    ======================================================== */

    if (!userId) {

      return {
        statusCode: 400,

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          success: false,
          premium: false,
          membership_plan: 'free',
          membership_status: 'active',
          error: 'Missing userId'
        })
      };

    }


    /* ========================================================
       GET USER MEMBERSHIP
    ======================================================== */

    const result =
      await pool.query(
        `
        SELECT
          user_id,
          premium,
          premium_until,
          membership_plan,
          membership_status
        FROM users
        WHERE user_id = $1
        LIMIT 1
        `,
        [userId]
      );


    /* ========================================================
       USER NOT FOUND
    ======================================================== */

    if (result.rows.length === 0) {

      return {
        statusCode: 404,

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          success: false,
          premium: false,
          membership_plan: 'free',
          membership_status: 'active',
          error: 'User not found'
        })
      };

    }


    const user =
      result.rows[0];


    /* ========================================================
       NORMALISE MEMBERSHIP PLAN
    ======================================================== */

    let membershipPlan =
      user.membership_plan || 'free';

    let membershipStatus =
      user.membership_status || 'active';


    /*
      Backwards compatibility:

      Older HanVerse accounts may only have
      premium = true without membership_plan.
    */

    if (
      membershipPlan === 'free' &&
      user.premium === true
    ) {

      membershipPlan =
        'premium';

    }


    /* ========================================================
       DETERMINE WHETHER MEMBERSHIP IS ACTIVE
    ======================================================== */

    let membershipActive =
      membershipStatus === 'active';


    /*
      If this is a Premium subscription and
      premium_until exists, make sure it hasn't expired.
    */

    if (
      membershipActive &&
      user.premium_until
    ) {

      const expiry =
        new Date(
          user.premium_until
        );

      const now =
        new Date();


      if (
        Number.isNaN(
          expiry.getTime()
        )
      ) {

        membershipActive = false;

      }
      else if (
        expiry <= now
      ) {

        membershipActive = false;

        /*
          Do not silently change the database here.
          Stripe/webhook remains responsible for
          authoritative membership changes.
        */

      }

    }


    /*
      Premium boolean should only be true when:

      1. The membership plan is premium
      2. The membership is active
      3. The membership has not expired
    */

    const premiumActive =
      membershipPlan === 'premium' &&
      membershipActive &&
      user.premium === true;


    /* ========================================================
       RESPONSE
    ======================================================== */

    return {

      statusCode: 200,

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({

        success: true,

        premium:
          premiumActive,

        membership_plan:
          membershipPlan,

        membership_status:
          membershipActive
            ? 'active'
            : membershipStatus,

        premium_until:
          user.premium_until || null

      })

    };

  }

  catch (error) {

    console.error(
      'HanVerse membership check error:',
      error
    );


    return {

      statusCode: 500,

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({

        success: false,

        premium: false,

        membership_plan: 'free',

        membership_status: 'active',

        error:
          'Unable to check membership status'

      })

    };

  }

};