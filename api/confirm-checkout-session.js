const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20'
});

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY environment variable.' });
  }

  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: 'Missing session ID.' });

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'customer', 'line_items.data.price.product']
    });

    const subscription = session.subscription;
    const isPaid = session.payment_status === 'paid' || subscription?.status === 'active' || subscription?.status === 'trialing';

    if (!isPaid) {
      return res.status(402).json({ error: 'Checkout has not completed payment yet.' });
    }

    return res.status(200).json({
      userId: session.client_reference_id || session.metadata?.userId || '',
      planId: session.metadata?.planId || subscription?.metadata?.planId || '',
      billingInterval: session.metadata?.billingInterval || subscription?.metadata?.billingInterval || 'monthly',
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id || '',
      stripeSubscriptionId: typeof subscription === 'string' ? subscription : subscription?.id || '',
      stripeSubscriptionStatus: typeof subscription === 'string' ? '' : subscription?.status || '',
      stripeCheckoutSessionId: session.id,
      value: Number(session.amount_total || 0) / 100,
      currency: String(session.currency || 'usd').toUpperCase()
    });
  } catch (error) {
    console.error('Stripe checkout confirmation error:', error);
    return res.status(500).json({ error: error.message || 'Unable to confirm Stripe Checkout.' });
  }
};
