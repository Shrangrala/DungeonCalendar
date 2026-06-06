const Stripe = require('stripe');
const admin = require('firebase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-11-17.clover'
});

function initFirebaseAdmin() {
  if (admin.apps.length) return admin.firestore();

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (!rawJson && !rawBase64) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable.');
  }

  const serviceAccount = JSON.parse(rawJson || Buffer.from(rawBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin.firestore();
}

async function updateUserPlan(userId, data) {
  if (!userId) return;
  const db = initFirebaseAdmin();
  await db.collection('users').doc(userId).set({
    ...data,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method not allowed.');
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).send('Missing STRIPE_WEBHOOK_SECRET.');
  }

  let event;
  try {
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await updateUserPlan(session.client_reference_id || session.metadata?.userId, {
        plan: session.metadata?.planId || 'free',
        billingInterval: session.metadata?.billingInterval || 'monthly',
        stripeCustomerId: session.customer || '',
        stripeSubscriptionId: session.subscription || '',
        stripeSubscriptionStatus: 'active'
      });
    }

    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;
      const active = ['active', 'trialing'].includes(subscription.status);
      await updateUserPlan(userId, {
        plan: active ? subscription.metadata?.planId || 'free' : 'free',
        billingInterval: active ? subscription.metadata?.billingInterval || 'monthly' : 'monthly',
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: subscription.customer || '',
        stripeSubscriptionStatus: subscription.status
      });
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      await updateUserPlan(subscription.metadata?.userId, {
        plan: 'free',
        billingInterval: 'monthly',
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: subscription.customer || '',
        stripeSubscriptionStatus: subscription.status || 'canceled'
      });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Stripe webhook handling error:', error);
    return res.status(500).send(error.message || 'Webhook handling failed.');
  }
};

event = stripe.webhooks.constructEvent(
  req.body,
  signature,
  process.env.STRIPE_WEBHOOK_SECRET
);
