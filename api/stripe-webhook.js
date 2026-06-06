const Stripe = require('stripe');
const admin = require('firebase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-11-17.clover'
});

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function initFirebaseAdmin() {
  if (admin.apps.length) return admin.firestore();

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (!rawJson && !rawBase64) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable.');
  }

  let serviceAccount;
  try {
    const jsonText = rawJson || Buffer.from(rawBase64, 'base64').toString('utf8');
    serviceAccount = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Invalid Firebase service account JSON: ${error.message}`);
  }

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin.firestore();
}

function normalizePlan(value) {
  const plan = String(value || '').toLowerCase();
  if (plan.includes('guild')) return 'guildmaster';
  if (plan.includes('advent')) return 'adventurer';
  if (plan.includes('free')) return 'free';
  return plan || 'free';
}

function normalizeBillingInterval(value) {
  const interval = String(value || '').toLowerCase();
  if (interval.includes('year') || interval.includes('annual')) return 'yearly';
  if (interval.includes('month')) return 'monthly';
  return interval || 'monthly';
}

function inferPlanFromPriceOrProduct(item) {
  const price = item?.price || {};
  const product = price?.product || {};
  return normalizePlan(
    price.metadata?.planId ||
    price.metadata?.plan ||
    product.metadata?.planId ||
    product.metadata?.plan ||
    price.nickname ||
    product.name ||
    ''
  );
}

function inferBillingInterval(subscription, item) {
  const price = item?.price || {};
  return normalizeBillingInterval(
    subscription?.metadata?.billingInterval ||
    price?.metadata?.billingInterval ||
    price?.recurring?.interval
  );
}

async function resolveSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price.product']
  });
}

async function updateUserAndCustomer(userId, data) {
  if (!userId) {
    console.warn('Stripe webhook: missing userId; skipped Firestore update.');
    return;
  }

  const db = initFirebaseAdmin();
  const now = new Date().toISOString();
  const cleanData = Object.fromEntries(
    Object.entries({ ...data, updatedAt: now }).filter(([, value]) => value !== undefined)
  );

  await Promise.all([
    db.collection('users').doc(userId).set(cleanData, { merge: true }),
    db.collection('customers').doc(userId).set(cleanData, { merge: true })
  ]);
}

async function handleCheckoutSessionCompleted(session) {
  const userId = session.client_reference_id || session.metadata?.userId || session.metadata?.uid || '';
  let subscription = null;

  if (session.subscription) {
    subscription = await resolveSubscription(session.subscription);
  }

  const firstItem = subscription?.items?.data?.[0];
  const active = subscription ? ['active', 'trialing'].includes(subscription.status) : true;
  const plan = normalizePlan(session.metadata?.planId || session.metadata?.plan || inferPlanFromPriceOrProduct(firstItem));
  const billingInterval = normalizeBillingInterval(session.metadata?.billingInterval || inferBillingInterval(subscription, firstItem));

  await updateUserAndCustomer(userId, {
    plan: active ? plan : 'free',
    billingInterval: active ? billingInterval : 'monthly',
    pendingStripePlan: admin.firestore.FieldValue.delete(),
    pendingStripeBillingInterval: admin.firestore.FieldValue.delete(),
    pendingStripeStartedAt: admin.firestore.FieldValue.delete(),
    stripeCustomerId: session.customer || subscription?.customer || '',
    stripeSubscriptionId: session.subscription || subscription?.id || '',
    stripeSubscriptionStatus: subscription?.status || 'active',
    stripeCheckoutSessionId: session.id,
    stripeWebhookLastEvent: 'checkout.session.completed',
    stripeActivationSource: 'stripe_webhook'
  });
}

async function handleSubscriptionChanged(subscription) {
  const userId = subscription.metadata?.userId || subscription.metadata?.uid || subscription.metadata?.firebaseUid || '';
  const firstItem = subscription.items?.data?.[0];
  const active = ['active', 'trialing'].includes(subscription.status);

  await updateUserAndCustomer(userId, {
    plan: active ? normalizePlan(subscription.metadata?.planId || subscription.metadata?.plan || inferPlanFromPriceOrProduct(firstItem)) : 'free',
    billingInterval: active ? normalizeBillingInterval(subscription.metadata?.billingInterval || inferBillingInterval(subscription, firstItem)) : 'monthly',
    pendingStripePlan: admin.firestore.FieldValue.delete(),
    pendingStripeBillingInterval: admin.firestore.FieldValue.delete(),
    pendingStripeStartedAt: admin.firestore.FieldValue.delete(),
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: subscription.customer || '',
    stripeSubscriptionStatus: subscription.status,
    stripeWebhookLastEvent: 'customer.subscription',
    stripeActivationSource: 'stripe_webhook'
  });
}

async function handleSubscriptionDeleted(subscription) {
  const userId = subscription.metadata?.userId || subscription.metadata?.uid || subscription.metadata?.firebaseUid || '';

  await updateUserAndCustomer(userId, {
    plan: 'free',
    billingInterval: 'monthly',
    pendingStripePlan: admin.firestore.FieldValue.delete(),
    pendingStripeBillingInterval: admin.firestore.FieldValue.delete(),
    pendingStripeStartedAt: admin.firestore.FieldValue.delete(),
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: subscription.customer || '',
    stripeSubscriptionStatus: subscription.status || 'canceled',
    stripeWebhookLastEvent: 'customer.subscription.deleted',
    stripeActivationSource: 'stripe_webhook'
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).send('Method not allowed.');
    }

    if (!process.env.STRIPE_SECRET_KEY) return res.status(500).send('Missing STRIPE_SECRET_KEY.');
    if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(500).send('Missing STRIPE_WEBHOOK_SECRET.');

    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      console.error('Stripe webhook signature verification failed:', error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    try {
      if (event.type === 'checkout.session.completed') {
        await handleCheckoutSessionCompleted(event.data.object);
      }

      if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
        await handleSubscriptionChanged(event.data.object);
      }

      if (event.type === 'customer.subscription.deleted') {
        await handleSubscriptionDeleted(event.data.object);
      }

      if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.payment_failed') {
        console.log(`Stripe webhook received ${event.type}; no direct Firestore update required.`);
      }

      return res.status(200).json({ received: true, type: event.type });
    } catch (error) {
      console.error('Stripe webhook handling error:', error);
      return res.status(500).json({ error: error.message || 'Webhook handling failed.' });
    }
  } catch (error) {
    console.error('WEBHOOK FATAL ERROR:', error);
    return res.status(500).json({ error: error.message || 'Webhook fatal error.' });
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};
