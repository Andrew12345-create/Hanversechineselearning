const { Pool } = require('pg');
const Stripe = require('stripe');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: true
    }
});

const stripe = Stripe(
    process.env.STRIPE_SECRET_KEY
);


/* ============================================================
   HANVERSE PLANS
============================================================ */

const PLANS = {

    yct: {
        name: 'HanVerse YCT Course',
        description:
            'YCT learning with structured lessons, videos, practice and progress tracking.',
        amount: 4,
        stripeAmount: 400,
        currency: 'usd'
    },

    premium: {
        name: 'HanVerse Premium',
        description:
            'Full HanVerse learning access including courses, videos, worksheets, achievements and premium features.',
        amount: 10,
        stripeAmount: 1000,
        currency: 'usd'
    }

};


/* ============================================================
   RESPONSE HELPER
============================================================ */

function json(statusCode, data) {

    return {

        statusCode,

        headers: {
            'Content-Type': 'application/json'
        },

        body: JSON.stringify(data)

    };

}


/* ============================================================
   HANDLER
============================================================ */

exports.handler = async (event) => {

    if (event.httpMethod !== 'POST') {

        return json(405, {
            success: false,
            error: 'Method not allowed'
        });

    }


    try {

        /* ====================================================
           PARSE REQUEST
        ==================================================== */

        let body;

        try {

            body = JSON.parse(
                event.body || '{}'
            );

        } catch (error) {

            return json(400, {

                success: false,

                error:
                    'Invalid JSON request'

            });

        }


        const userId =
            body.userId;

        const requestedPlan =
            body.plan;


        /* ====================================================
           VALIDATE USER
        ==================================================== */

        if (!userId) {

            return json(400, {

                success: false,

                error:
                    'Missing userId'

            });

        }


        /* ====================================================
           VALIDATE PLAN
        ==================================================== */

        if (
            !requestedPlan ||
            !PLANS[requestedPlan]
        ) {

            return json(400, {

                success: false,

                error:
                    'Invalid membership plan'

            });

        }


        const selectedPlan =
            PLANS[requestedPlan];


        /* ====================================================
           GET USER
        ==================================================== */

        const userResult =
            await pool.query(

                `
                SELECT
                    user_id,
                    email,
                    premium,
                    premium_until,
                    membership_plan,
                    membership_status,
                    stripe_customer_id,
                    stripe_subscription_id

                FROM users

                WHERE user_id = $1

                LIMIT 1
                `,

                [userId]

            );


        if (
            userResult.rows.length === 0
        ) {

            return json(404, {

                success: false,

                error:
                    'User not found'

            });

        }


        const user =
            userResult.rows[0];


        /* ====================================================
           CURRENT MEMBERSHIP
        ==================================================== */

        let currentPlan =
            user.membership_plan ||
            'free';


        /*
         * Backwards compatibility with
         * older Premium accounts.
         */

        if (
            currentPlan === 'free' &&
            user.premium === true
        ) {

            currentPlan =
                'premium';

        }


        let membershipActive =
            user.membership_status === 'active';


        /* ====================================================
           EXPIRY CHECK
        ==================================================== */

        if (
            membershipActive &&
            user.premium_until
        ) {

            const expiry =
                new Date(
                    user.premium_until
                );


            if (
                !Number.isNaN(
                    expiry.getTime()
                ) &&
                expiry <= new Date()
            ) {

                membershipActive =
                    false;

            }

        }


        /* ====================================================
           ONLY ONE PAID PLAN
        ==================================================== */

        if (
            currentPlan !== 'free' &&
            membershipActive
        ) {

            const planName =
                currentPlan === 'yct'
                    ? 'YCT Course'
                    : 'Premium';


            return json(409, {

                success: false,

                code:
                    'ACTIVE_MEMBERSHIP',

                current_plan:
                    currentPlan,

                requested_plan:
                    requestedPlan,

                error:
                    `You already have an active ${planName} membership. Only one paid membership can be active at a time.`

            });

        }


        /* ====================================================
           STRIPE CUSTOMER
        ==================================================== */

        let customerId =
            user.stripe_customer_id ||
            null;


        if (!customerId) {

            const customer =
                await stripe.customers.create({

                    email:
                        user.email,

                    metadata: {

                        userId:
                            String(user.user_id)

                    }

                });


            customerId =
                customer.id;


            await pool.query(

                `
                UPDATE users

                SET
                    stripe_customer_id = $1,
                    updated_at = NOW()

                WHERE user_id = $2
                `,

                [
                    customerId,
                    userId
                ]

            );

        }


        /* ====================================================
           STRIPE CHECKOUT
        ==================================================== */

        const session =
            await stripe.checkout.sessions.create({

                mode:
                    'subscription',

                customer:
                    customerId,

                payment_method_types:
                    ['card'],

                line_items: [

                    {

                        price_data: {

                            currency:
                                selectedPlan.currency,

                            product_data: {

                                name:
                                    selectedPlan.name,

                                description:
                                    selectedPlan.description

                            },

                            recurring: {

                                interval:
                                    'month'

                            },

                            unit_amount:
                                selectedPlan.stripeAmount

                        },

                        quantity: 1

                    }

                ],


                /* ==========================================
                   CHECKOUT METADATA
                ========================================== */

                metadata: {

                    userId:
                        String(user.user_id),

                    plan:
                        requestedPlan

                },


                /* ==========================================
                   SUBSCRIPTION METADATA
                ========================================== */

                subscription_data: {

                    metadata: {

                        userId:
                            String(user.user_id),

                        plan:
                            requestedPlan

                    }

                },


                success_url:
                    'https://hanverse.netlify.app/payment.html?payment=success&plan='
                    + encodeURIComponent(
                        requestedPlan
                    ),


                cancel_url:
                    'https://hanverse.netlify.app/payment.html?payment=cancelled'

            });


        /* ====================================================
           SAVE CHECKOUT TO PAYMENTS
           
           IMPORTANT:
           Your existing table uses `amount`,
           not `amount_cents`.
        ==================================================== */

        await pool.query(

            `
            INSERT INTO payments (

                stripe_customer_id,

                stripe_checkout_session_id,

                plan,

                amount,

                currency,

                status,

                user_id,

                created_at,

                updated_at

            )

            VALUES (

                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                NOW(),
                NOW()

            )
            `,

            [

                customerId,

                session.id,

                requestedPlan,

                selectedPlan.amount,

                selectedPlan.currency,

                'checkout_created',

                user.user_id

            ]

        );


        /* ====================================================
           SUCCESS
        ==================================================== */

        return json(200, {

            success: true,

            url:
                session.url,

            plan:
                requestedPlan,

            amount:
                selectedPlan.amount,

            currency:
                selectedPlan.currency

        });


    }

    catch (error) {

        console.error(
            'Create checkout session error:',
            error
        );


        return json(500, {

            success: false,

            error:
                error.message ||
                'Unable to create checkout session'

        });

    }

};
