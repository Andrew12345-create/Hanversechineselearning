const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed'
      })
    };
  }

  try {
    const { userId, email } = JSON.parse(event.body);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Hanverse Premium',
              description: 'Full access to Hanverse courses, videos, worksheets, achievements and premium features.'
            },
            recurring: {
              interval: 'month'
            },
            unit_amount: 400
          },
          quantity: 1
        }
      ],
      metadata: {
        userId: userId
      },
      success_url: 'https://hanverse.netlify.app/payment.html?payment=success',
      cancel_url: 'https://hanverse.netlify.app/payment.html?payment=cancelled'
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        url: session.url
      })
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};