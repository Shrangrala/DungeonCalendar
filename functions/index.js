const express = require('express');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const Stripe = require('stripe');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });

const app = express();

const allowedOrigins = new Set([
  'https://www.dungeoncalendar.com',
  'https://dungeoncalendar.com',
  'https://dungeon-calendar-app.web.app',
  'http://localhost:19006',
  'http://localhost:8081',
  'http://localhost:5173'
]);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

app.use((req, res, next) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
});

app.use((req, res, next) => {
  if (req.path === '/api/stripe-webhook') return next();
  return express.json({ limit: '1mb' })(req, res, next);
});
app.use('/api/stripe-webhook', express.raw({ type: 'application/json' }));

const priceEnvByPlan = {
  adventurer: { monthly: 'STRIPE_PRICE_ADVENTURER_MONTHLY', yearly: 'STRIPE_PRICE_ADVENTURER_YEARLY' },
  guildmaster: { monthly: 'STRIPE_PRICE_GUILDMASTER_MONTHLY', yearly: 'STRIPE_PRICE_GUILDMASTER_YEARLY' }
};

function normalizeEmail(email = '') { return String(email || '').trim().toLowerCase(); }
function normalizePlan(plan = '') {
  const value = String(plan || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['adventurer', 'adventure', 'adventurerplan'].includes(value)) return 'adventurer';
  if (['guildmaster', 'guild', 'guildmasterplan'].includes(value)) return 'guildmaster';
  return '';
}
function normalizeBillingInterval(interval = '') {
  return ['yearly', 'year', 'annual', 'annually'].includes(String(interval || '').trim().toLowerCase()) ? 'yearly' : 'monthly';
}
function readStripeCustomerId(data = {}) {
  return String(data.stripeCustomerId || data.customerId || data.stripeId || '').trim();
}
function cleanData(data = {}) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}
function customerLink(customerId) { return `https://dashboard.stripe.com/customers/${customerId}`; }
function subscriptionLink(subscriptionId) { return `https://dashboard.stripe.com/subscriptions/${subscriptionId}`; }

function safeReturnOrigin(req, returnUrl) {
  const fallback = 'https://www.dungeoncalendar.com';
  try {
    const parsed = new URL(String(returnUrl || '').trim());
    if (allowedOrigins.has(parsed.origin)) return parsed.origin;
  } catch (_) {}
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) return origin;
  return fallback;
}

async function getStoredCustomerId(userId) {
  const [userSnap, customerSnap] = await Promise.all([
    db.collection('users').doc(userId).get().catch(() => null),
    db.collection('customers').doc(userId).get().catch(() => null)
  ]);
  return readStripeCustomerId(userSnap?.data?.() || {}) || readStripeCustomerId(customerSnap?.data?.() || {});
}

async function findCustomerByEmailOrUid(email, userId) {
  if (!email && !userId) return '';
  if (email) {
    const list = await stripe.customers.list({ email, limit: 100 });
    const live = (list.data || []).filter((customer) => !customer.deleted);
    const exactUid = live.find((customer) => {
      const meta = customer.metadata || {};
      return [meta.userId, meta.uid, meta.firebaseUid, meta.firebaseUID, meta.firebaseUserId].includes(userId);
    });
    if (exactUid) return exactUid.id;
    if (live.length === 1) return live[0].id;
  }
  return '';
}

async function saveCustomerLink(userId, email, customerId, extra = {}) {
  const data = cleanData({
    email,
    stripeId: customerId,
    stripeCustomerId: customerId,
    customerId,
    stripeLink: customerLink(customerId),
    updatedAt: new Date().toISOString(),
    ...extra
  });
  await Promise.all([
    db.collection('users').doc(userId).set(data, { merge: true }),
    db.collection('customers').doc(userId).set(data, { merge: true })
  ]);
}

async function ensureLinkedCustomer({ userId, email, name }) {
  let customerId = await getStoredCustomerId(userId);
  if (customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (!customer || customer.deleted) customerId = '';
    } catch (_) { customerId = ''; }
  }
  if (!customerId) customerId = await findCustomerByEmailOrUid(email, userId);

  const metadata = { userId, uid: userId, firebaseUid: userId, firebaseUID: userId };
  if (!customerId) {
    const customer = await stripe.customers.create({ email: email || undefined, name: name || undefined, metadata });
    customerId = customer.id;
  } else {
    const existing = await stripe.customers.retrieve(customerId);
    await stripe.customers.update(customerId, {
      email: email || existing.email || undefined,
      name: name || existing.name || undefined,
      metadata: { ...(existing.metadata || {}), ...metadata }
    });
  }
  await saveCustomerLink(userId, email, customerId);
  return customerId;
}

app.post('/api/create-checkout-session', async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY in Firebase Functions environment.' });
  try {
    const { planId, billingInterval, userId, email, name, returnUrl } = req.body || {};
    const safePlan = normalizePlan(planId);
    const safeInterval = normalizeBillingInterval(billingInterval);
    const safeUserId = String(userId || '').trim();
    const safeEmail = normalizeEmail(email);
    if (!safePlan || !safeUserId) return res.status(400).json({ error: 'Missing plan or Firebase user ID.' });
    const envName = priceEnvByPlan[safePlan][safeInterval];
    const priceId = process.env[envName];
    if (!priceId) return res.status(500).json({ error: `Missing ${envName} in Firebase Functions environment.` });

    const customerId = await ensureLinkedCustomer({ userId: safeUserId, email: safeEmail, name });
    const origin = safeReturnOrigin(req, returnUrl);
    const successUrl = new URL('/subscription-complete', origin);
    successUrl.searchParams.set('stripe_success', 'true');
    successUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
    successUrl.searchParams.set('stripe_plan', safePlan);
    successUrl.searchParams.set('stripe_billing', safeInterval);
    const cancelUrl = new URL(origin);
    cancelUrl.searchParams.set('stripe_cancelled', 'true');

    const metadata = { userId: safeUserId, uid: safeUserId, firebaseUid: safeUserId, firebaseUID: safeUserId, planId: safePlan, billingInterval: safeInterval };
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: safeUserId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer_update: { name: 'auto', address: 'auto' },
      metadata,
      subscription_data: { metadata },
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString()
    });
    return res.status(200).json({ url: session.url, customerId });
  } catch (error) {
    console.error('create-checkout-session failed:', error);
    return res.status(500).json({ error: error.message || 'Unable to start Stripe Checkout.' });
  }
});

app.get('/api/confirm-checkout-session', async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY in Firebase Functions environment.' });
  try {
    const sessionId = String(req.query.session_id || '').trim();
    if (!sessionId) return res.status(400).json({ error: 'Missing session ID.' });
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription', 'customer'] });
    const subscription = session.subscription;
    const isPaid = session.payment_status === 'paid' || ['active', 'trialing'].includes(subscription?.status);
    if (!isPaid) return res.status(402).json({ error: 'Checkout has not completed payment yet.' });
    return res.status(200).json({
      userId: session.client_reference_id || session.metadata?.userId || '',
      planId: session.metadata?.planId || subscription?.metadata?.planId || '',
      billingInterval: session.metadata?.billingInterval || subscription?.metadata?.billingInterval || 'monthly',
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id || '',
      stripeSubscriptionId: typeof subscription === 'string' ? subscription : subscription?.id || '',
      stripeSubscriptionStatus: typeof subscription === 'string' ? '' : subscription?.status || '',
      stripeCheckoutSessionId: session.id
    });
  } catch (error) {
    console.error('confirm-checkout-session failed:', error);
    return res.status(500).json({ error: error.message || 'Unable to confirm Stripe Checkout.' });
  }
});

async function userIdForCustomer(customerId, customerObject = null) {
  const customer = customerObject || await stripe.customers.retrieve(customerId).catch(() => null);
  const meta = customer?.metadata || {};
  let userId = meta.userId || meta.uid || meta.firebaseUid || meta.firebaseUID || meta.firebaseUserId || '';
  if (userId) return userId;
  const email = normalizeEmail(customer?.email || '');
  if (!email) return '';
  const users = await db.collection('users').where('email', '==', email).limit(1).get();
  if (!users.empty) return users.docs[0].id;
  return '';
}

async function saveSubscription(subscription) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (!customerId) return;
  const userId = await userIdForCustomer(customerId, typeof subscription.customer === 'object' ? subscription.customer : null);
  if (!userId) return;
  const item = subscription.items?.data?.[0] || {};
  const price = item.price || {};
  const planId = normalizePlan(subscription.metadata?.planId || price.metadata?.plan || price.lookup_key || price.nickname || '') || undefined;
  const billingInterval = normalizeBillingInterval(subscription.metadata?.billingInterval || price.recurring?.interval || 'monthly');
  await saveCustomerLink(userId, '', customerId, {
    stripeSubscriptionId: subscription.id,
    subscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    subscriptionStatus: subscription.status,
    stripeSubscriptionLink: subscriptionLink(subscription.id),
    plan: ['active', 'trialing', 'past_due'].includes(subscription.status) ? planId : undefined,
    billingInterval: ['active', 'trialing', 'past_due'].includes(subscription.status) ? billingInterval : undefined,
    active: ['active', 'trialing'].includes(subscription.status)
  });
  await db.collection('customers').doc(userId).collection('subscriptions').doc(subscription.id).set(cleanData({
    id: subscription.id,
    status: subscription.status,
    stripeSubscriptionStatus: subscription.status,
    stripeCustomerId: customerId,
    plan: planId,
    billingInterval,
    priceId: price.id,
    productId: typeof price.product === 'string' ? price.product : price.product?.id,
    current_period_start: subscription.current_period_start || undefined,
    current_period_end: subscription.current_period_end || undefined,
    updatedAt: new Date().toISOString()
  }), { merge: true });
}

app.post('/api/stripe-webhook', async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    if (secret) {
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } else {
      event = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '{}'));
    }
  } catch (error) {
    console.error('stripe-webhook signature/body error:', error);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['customer', 'items.data.price.product'] });
        await saveSubscription(subscription);
      }
    }
    if (event.type && event.type.startsWith('customer.subscription.')) {
      const subscription = event.data.object;
      await saveSubscription(subscription);
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('stripe-webhook handler error:', error);
    return res.status(500).json({ error: error.message || 'Webhook failed.' });
  }
});

exports.api = onRequest({ region: 'us-central1' }, app);
