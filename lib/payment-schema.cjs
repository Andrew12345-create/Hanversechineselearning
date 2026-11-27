'use strict';

/**
 * Idempotent payment schema convergence shared by the Express API,
 * checkout function and Stripe webhook. Amounts are stored in major
 * currency units (for example USD 4.00), never cents.
 */
const readyByPool = new WeakMap();

async function ensurePaymentSchema(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('A PostgreSQL pool is required for payment schema setup.');
  }
  if (readyByPool.has(pool)) return readyByPool.get(pool);

  const ready = (async () => {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS premium BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_plan VARCHAR(30) NOT NULL DEFAULT 'free';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_status VARCHAR(30) NOT NULL DEFAULT 'active';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_used BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        payment_id BIGSERIAL PRIMARY KEY,
        user_id INTEGER,
        stripe_customer_id VARCHAR(255),
        stripe_checkout_session_id VARCHAR(255),
        plan VARCHAR(30) NOT NULL DEFAULT 'free',
        amount NUMERIC(10,2) NOT NULL DEFAULT 0,
        currency VARCHAR(10) NOT NULL DEFAULT 'usd',
        status VARCHAR(30) NOT NULL DEFAULT 'checkout_created',
        stripe_subscription_id VARCHAR(255),
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_id BIGSERIAL;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS user_id INTEGER;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_checkout_session_id VARCHAR(255);
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan VARCHAR(30) NOT NULL DEFAULT 'free';
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2) NOT NULL DEFAULT 0;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'usd';
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'checkout_created';
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    // Migrate legacy cents values once, without overwriting populated amounts.
    await pool.query(`
      DO $migration$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'payments'
            AND column_name = 'amount_cents'
        ) THEN
          EXECUTE 'UPDATE payments SET amount = amount_cents::numeric / 100 WHERE COALESCE(amount, 0) = 0 AND amount_cents IS NOT NULL';
        END IF;
      END
      $migration$;
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_user_created
        ON payments(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_payments_subscription
        ON payments(stripe_subscription_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_checkout_session
        ON payments(stripe_checkout_session_id);
    `);
  })().catch(error => {
    readyByPool.delete(pool);
    throw error;
  });

  readyByPool.set(pool, ready);
  return ready;
}

module.exports = { ensurePaymentSchema };
