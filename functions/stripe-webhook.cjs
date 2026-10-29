const { Pool } = require('pg');
const Stripe = require('stripe');


/* ============================================================
   DATABASE
============================================================ */

const pool = new Pool({

  connectionString:
    process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: true
  }

});


/* ============================================================
   STRIPE
============================================================ */

const stripe =
  Stripe(
    process.env.STRIPE_SECRET_KEY
  );


/* ============================================================
   HELPER
============================================================ */

function getPlanAmount(plan) {

  if (plan === 'premium') {

    return 1000;

  }

  if (plan === 'yct') {

    return 400;

  }

  return 0;

}


/* ============================================================
   HANDLER
============================================================ */

exports.handler = async (event) => {


  /* ==========================================================
     ONLY STRIPE POST REQUESTS
  ========================================================== */

  if (
    event.httpMethod !== 'POST'
  ) {

    return {

      statusCode: 405,

      body:
        'Method not allowed'

    };

  }


  /* ==========================================================
     STRIPE SIGNATURE
  ========================================================== */

  const signature =
    event.headers['stripe-signature'] ||
    event.headers['Stripe-Signature'];


  if (!signature) {

    return {

      statusCode: 400,

      body:
        'Missing Stripe signature'

    };

  }


  let stripeEvent;


  /* ==========================================================
     VERIFY STRIPE EVENT
  ========================================================== */

  try {

    const rawBody =
      event.isBase64Encoded

        ? Buffer
            .from(
              event.body,
              'base64'
            )
            .toString('utf8')

        : event.body;


    stripeEvent =
      stripe.webhooks.constructEvent(

        rawBody,

        signature,

        process.env.STRIPE_WEBHOOK_SECRET

      );

  }

  catch (error) {

    console.error(
      'Stripe webhook signature verification failed:',
      error.message
    );


    return {

      statusCode: 400,

      body:
        `Webhook Error: ${error.message}`

    };

  }


  /* ========================================================
     IDEMPOTENCY GATE
     Stripe retries webhooks (at-least-once delivery). Without this,
     a retried checkout.session.completed could double-apply premium
     days or XP. Record the event id first; a conflict means replay.
  ======================================================== */

  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS stripe_events (
        event_id VARCHAR(255) PRIMARY KEY,
        type VARCHAR(100),
        received_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );
    const inserted = await pool.query(
      `INSERT INTO stripe_events (event_id, type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [stripeEvent.id, stripeEvent.type]
    );
    if (inserted.rowCount === 0) {
      console.log(`↩️ Duplicate Stripe event ${stripeEvent.id} (${stripeEvent.type}) — skipped`);
      return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
    }
  } catch (idempotencyError) {
    // Fail closed: if we cannot record the event, do not risk double-apply.
    console.error('Webhook idempotency check failed:', idempotencyError.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Idempotency recording failed — event not processed' }) };
  }

  try {


    /* ========================================================
       CHECKOUT COMPLETED
    ======================================================== */

    if (
      stripeEvent.type ===
      'checkout.session.completed'
    ) {


      const session =
        stripeEvent.data.object;


      const userId =
        session.metadata?.userId;


      const plan =
        session.metadata?.plan;


      /* ------------------------------------------------------
         Validate metadata
      ------------------------------------------------------ */

      if (
        !userId ||
        !plan
      ) {

        console.error(
          'Checkout session missing userId or plan metadata.'
        );

        return {

          statusCode: 400,

          body:
            'Missing checkout metadata'

        };

      }


      if (
        !['yct', 'premium'].includes(plan)
      ) {

        console.error(
          'Invalid membership plan:',
          plan
        );

        return {

          statusCode: 400,

          body:
            'Invalid membership plan'

        };

      }


      /* ------------------------------------------------------
         Stripe subscription
      ------------------------------------------------------ */

      const subscription =
        await stripe.subscriptions.retrieve(
          session.subscription
        );


      const periodStart =
        new Date(
          subscription.current_period_start * 1000
        );


      const periodEnd =
        new Date(
          subscription.current_period_end * 1000
        );


      const customerId =
        typeof session.customer === 'string'

          ? session.customer

          : session.customer?.id;


      const subscriptionId =
        subscription.id;


      /* ------------------------------------------------------
         Determine active state
      ------------------------------------------------------ */

      const active =
        subscription.status === 'active' ||
        subscription.status === 'trialing';


      if (!active) {

        console.log(
          `Checkout completed but subscription is ${subscription.status}`
        );

        return {

          statusCode: 200,

          body:
            JSON.stringify({
              received: true
            })

        };

      }


      /* ======================================================
         SAFETY:
         ONE PAID PLAN PER USER
      ====================================================== */

      const existing =
        await pool.query(

          `
          SELECT
            payment_id,
            plan,
            stripe_subscription_id
          FROM payments
          WHERE user_id = $1
            AND status = 'active'
          LIMIT 1
          `,

          [
            String(userId)
          ]

        );


      /*
        If another active subscription already exists,
        don't silently give the user two memberships.
      */

      if (
        existing.rows.length > 0 &&
        existing.rows[0].stripe_subscription_id !==
          subscriptionId
      ) {

        console.error(
          'Multiple active memberships detected for user:',
          userId
        );

        /*
          We leave the existing membership untouched.
          The duplicate should be handled/refunded through
          Stripe/admin processes rather than silently replacing it.
        */

        return {

          statusCode: 409,

          body:
            'User already has an active membership'

        };

      }


      /* ======================================================
         UPDATE USERS
      ====================================================== */

      await pool.query(

        `
        UPDATE users

        SET

          membership_plan = $1,

          membership_status = 'active',

          premium = $2,

          premium_until = $3,

          stripe_customer_id = $4,

          stripe_subscription_id = $5,

          updated_at = NOW()

        WHERE user_id = $6
        `,

        [

          plan,

          plan === 'premium',

          periodEnd,

          customerId,

          subscriptionId,

          userId

        ]

      );


      /* ======================================================
         UPDATE PAYMENT RECORD
      ====================================================== */

      await pool.query(

        `
        UPDATE payments

        SET

          plan = $1,

          amount_cents = $2,

          currency = 'usd',

          status = 'active',

          stripe_customer_id = $3,

          stripe_subscription_id = $4,

          current_period_start = $5,

          current_period_end = $6,

          updated_at = NOW()

        WHERE stripe_checkout_session_id = $7
        `,

        [

          plan,

          getPlanAmount(plan),

          customerId,

          subscriptionId,

          periodStart,

          periodEnd,

          session.id

        ]

      );


      console.log(
        `HanVerse membership activated: user=${userId}, plan=${plan}`
      );

    }


    /* ========================================================
       SUBSCRIPTION UPDATED
    ======================================================== */

    else if (
      stripeEvent.type ===
      'customer.subscription.updated'
    ) {


      const subscription =
        stripeEvent.data.object;


      const userId =
        subscription.metadata?.userId;


      const plan =
        subscription.metadata?.plan;


      if (
        !userId ||
        !plan
      ) {

        console.warn(
          'Subscription update missing metadata.'
        );

        return {

          statusCode: 200,

          body:
            'Missing metadata'

        };

      }


      const active =
        subscription.status === 'active' ||
        subscription.status === 'trialing';


      const periodStart =
        new Date(
          subscription.current_period_start * 1000
        );


      const periodEnd =
        new Date(
          subscription.current_period_end * 1000
        );


      const customerId =
        typeof subscription.customer === 'string'

          ? subscription.customer

          : subscription.customer?.id;


      /* ------------------------------------------------------
         Update user
      ------------------------------------------------------ */

      await pool.query(

        `
        UPDATE users

        SET

          membership_plan = $1,

          membership_status = $2,

          premium = $3,

          premium_until = $4,

          stripe_customer_id = $5,

          stripe_subscription_id = $6,

          updated_at = NOW()

        WHERE user_id = $7
        `,

        [

          plan,

          active
            ? 'active'
            : subscription.status,

          plan === 'premium' && active,

          active
            ? periodEnd
            : null,

          customerId,

          subscription.id,

          userId

        ]

      );


      /* ------------------------------------------------------
         Update payment
      ------------------------------------------------------ */

      await pool.query(

        `
        UPDATE payments

        SET

          status = $1,

          current_period_start = $2,

          current_period_end = $3,

          updated_at = NOW()

        WHERE stripe_subscription_id = $4
        `,

        [

          active
            ? 'active'
            : subscription.status === 'past_due'
              ? 'past_due'
              : 'expired',

          active
            ? periodStart
            : null,

          active
            ? periodEnd
            : null,

          subscription.id

        ]

      );


      console.log(
        `HanVerse subscription updated: user=${userId}, plan=${plan}, status=${subscription.status}`
      );

    }


    /* ========================================================
       SUBSCRIPTION CANCELLED
    ======================================================== */

    else if (
      stripeEvent.type ===
      'customer.subscription.deleted'
    ) {


      const subscription =
        stripeEvent.data.object;


      const userId =
        subscription.metadata?.userId;


      const plan =
        subscription.metadata?.plan;


      if (!userId) {

        return {

          statusCode: 200,

          body:
            'No user ID'

        };

      }


      /* ------------------------------------------------------
         User becomes Free
      ------------------------------------------------------ */

      await pool.query(

        `
        UPDATE users

        SET

          membership_plan = 'free',

          membership_status = 'cancelled',

          premium = FALSE,

          premium_until = NULL,

          stripe_subscription_id = NULL,

          updated_at = NOW()

        WHERE user_id = $1

        AND stripe_subscription_id = $2
        `,

        [

          userId,

          subscription.id

        ]

      );


      /* ------------------------------------------------------
         Payment history remains
      ------------------------------------------------------ */

      await pool.query(

        `
        UPDATE payments

        SET

          status = 'cancelled',

          updated_at = NOW()

        WHERE stripe_subscription_id = $1
        `,

        [
          subscription.id
        ]

      );


      console.log(
        `HanVerse membership cancelled: user=${userId}, plan=${plan || 'unknown'}`
      );

    }


    /* ========================================================
       INVOICE PAID
    ======================================================== */

    else if (
      stripeEvent.type ===
      'invoice.paid'
    ) {


      const invoice =
        stripeEvent.data.object;


      if (
        !invoice.subscription
      ) {

        return {

          statusCode: 200,

          body:
            'No subscription'

        };

      }


      const subscription =
        await stripe.subscriptions.retrieve(
          invoice.subscription
        );


      const userId =
        subscription.metadata?.userId;


      const plan =
        subscription.metadata?.plan;


      if (
        !userId ||
        !plan
      ) {

        return {

          statusCode: 200,

          body:
            'Missing metadata'

        };

      }


      const periodStart =
        new Date(
          subscription.current_period_start * 1000
        );


      const periodEnd =
        new Date(
          subscription.current_period_end * 1000
        );


      /* ------------------------------------------------------
         Renew user membership
      ------------------------------------------------------ */

      await pool.query(

        `
        UPDATE users

        SET

          membership_plan = $1,

          membership_status = 'active',

          premium = $2,

          premium_until = $3,

          updated_at = NOW()

        WHERE user_id = $4

        AND stripe_subscription_id = $5
        `,

        [

          plan,

          plan === 'premium',

          periodEnd,

          userId,

          subscription.id

        ]

      );


      /* ------------------------------------------------------
         Renew payment record
      ------------------------------------------------------ */

      await pool.query(

        `
        UPDATE payments

        SET

          status = 'paid',

          current_period_start = $1,

          current_period_end = $2,

          updated_at = NOW()

        WHERE stripe_subscription_id = $3
        `,

        [

          periodStart,

          periodEnd,

          subscription.id

        ]

      );


      console.log(
        `HanVerse subscription payment received: user=${userId}, plan=${plan}`
      );

    }


    /* ========================================================
       INVOICE PAYMENT FAILED
    ======================================================== */

    else if (
      stripeEvent.type ===
      'invoice.payment_failed'
    ) {


      const invoice =
        stripeEvent.data.object;


      if (
        !invoice.subscription
      ) {

        return {

          statusCode: 200,

          body:
            'No subscription'

        };

      }


      const subscription =
        await stripe.subscriptions.retrieve(
          invoice.subscription
        );


      const userId =
        subscription.metadata?.userId;


      if (!userId) {

        return {

          statusCode: 200,

          body:
            'No user ID'

        };

      }


      /*
        Do NOT immediately delete Premium.

        Stripe may retry the payment.
      */

      await pool.query(

        `
        UPDATE users

        SET

          membership_status = 'past_due',

          updated_at = NOW()

        WHERE user_id = $1

        AND stripe_subscription_id = $2
        `,

        [

          userId,

          subscription.id

        ]

      );


      await pool.query(

        `
        UPDATE payments

        SET

          status = 'past_due',

          updated_at = NOW()

        WHERE stripe_subscription_id = $1
        `,

        [

          subscription.id

        ]

      );


      console.log(
        `HanVerse payment failed: user=${userId}`
      );

    }


    /* ========================================================
       UNKNOWN EVENT
    ======================================================== */

    else {

      console.log(
        `Unhandled Stripe event: ${stripeEvent.type}`
      );

    }


    /* ========================================================
       SUCCESSFUL STRIPE RESPONSE
    ======================================================== */

    return {

      statusCode: 200,

      headers: {
        'Content-Type':
          'application/json'
      },

      body: JSON.stringify({

        received: true

      })

    };

  }

  catch (error) {

    console.error(
      'HanVerse Stripe webhook processing error:',
      error
    );


    return {

      statusCode: 500,

      headers: {
        'Content-Type':
          'application/json'
      },

      body: JSON.stringify({

        received: false,

        error:
          'Webhook processing failed'

      })

    };

  }

};