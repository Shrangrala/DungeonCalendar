const express = require('express');
const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const Stripe = require('stripe');

admin.initializeApp();
const db = admin.firestore();
const app = express();

const allowedOrigins = new Set([
  'https://www.dungeoncalendar.com',
  'https://dungeoncalendar.com',
  'https://dungeon-calendar-app.web.app',
  'https://dungeon-calendar-app.firebaseapp.com'
]);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Stripe-Signature');
}

app.use((req, res, next) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.post(['/stripe-webhook', '/api/stripe-webhook'], express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  let event;
  try {
    const signature = req.headers['stripe-signature'];
    event = process.env.STRIPE_WEBHOOK_SECRET
      ? stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET)
      : JSON.parse(req.body.toString('utf8'));
  } catch (error) {
    console.error('Stripe webhook signature/body error:', error);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await applyCheckoutSession(event.data.object);
    } else if (event.type.startsWith('customer.subscription.')) {
      await applySubscription(event.data.object);
    }
    return res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook handler error:', error);
    return res.status(500).json({ error: error.message || 'Webhook failed.' });
  }
});

app.use(express.json());

const priceEnvByPlan = {
  adventurer: {
    monthly: 'STRIPE_PRICE_ADVENTURER_MONTHLY',
    yearly: 'STRIPE_PRICE_ADVENTURER_YEARLY'
  },
  guildmaster: {
    monthly: 'STRIPE_PRICE_GUILDMASTER_MONTHLY',
    yearly: 'STRIPE_PRICE_GUILDMASTER_YEARLY'
  }
};

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY environment variable.');
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
}

function normalizePlan(plan) {
  return ['adventurer', 'guildmaster'].includes(plan) ? plan : 'free';
}

function normalizeInterval(interval) {
  return ['monthly', 'yearly'].includes(interval) ? interval : 'monthly';
}

function siteOrigin(req, rawReturnUrl) {
  const fallback = process.env.PUBLIC_SITE_URL || 'https://dungeon-calendar-app.web.app';
  try {
    const parsed = new URL(rawReturnUrl || fallback);
    return allowedOrigins.has(parsed.origin) ? parsed.origin : fallback;
  } catch {
    return fallback;
  }
}

async function getOrCreateStripeCustomer(stripe, { uid, email, name }) {
  const customerRef = db.collection('customers').doc(uid);
  const userRef = db.collection('users').doc(uid);
  const [customerSnap, userSnap] = await Promise.all([customerRef.get(), userRef.get()]);
  const customerDoc = customerSnap.exists ? customerSnap.data() || {} : {};
  const userDoc = userSnap.exists ? userSnap.data() || {} : {};
  const existingId = customerDoc.stripeId || customerDoc.stripeCustomerId || userDoc.stripeCustomerId || '';

  if (existingId) {
    const customer = await stripe.customers.update(existingId, {
      email: email || customerDoc.email || userDoc.email || undefined,
      name: name || userDoc.name || userDoc.username || undefined,
      metadata: {
        ...(customerDoc.metadata || {}),
        firebaseUID: uid,
        userId: uid
      }
    });
    await saveCustomerLink(uid, customer, { email, name });
    return customer.id;
  }

  const byEmail = email ? await stripe.customers.list({ email, limit: 10 }) : { data: [] };
  const matching = byEmail.data.find((c) => c.metadata?.firebaseUID === uid || c.metadata?.userId === uid) || byEmail.data[0];
  if (matching) {
    const customer = await stripe.customers.update(matching.id, {
      metadata: {
        ...(matching.metadata || {}),
        firebaseUID: uid,
        userId: uid
      }
    });
    await saveCustomerLink(uid, customer, { email, name });
    return customer.id;
  }

  const created = await stripe.customers.create({
    email: email || undefined,
    name: name || undefined,
    metadata: {
      firebaseUID: uid,
      userId: uid
    }
  });
  await saveCustomerLink(uid, created, { email, name });
  return created.id;
}

async function saveCustomerLink(uid, customer, { email, name } = {}) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const data = {
    uid,
    email: email || customer.email || '',
    name: name || customer.name || '',
    stripeId: customer.id,
    stripeCustomerId: customer.id,
    stripeLink: `https://dashboard.stripe.com/customers/${customer.id}`,
    updatedAt: now
  };
  await db.collection('customers').doc(uid).set(data, { merge: true });
  await db.collection('users').doc(uid).set({ stripeCustomerId: customer.id, updatedAt: now }, { merge: true });
}


app.get(['/debug-env', '/api/debug-env'], (req, res) => {
  return res.json({
    ok: true,
    stripeSecretKeyConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    adventurerMonthlyConfigured: Boolean(process.env.STRIPE_PRICE_ADVENTURER_MONTHLY),
    adventurerYearlyConfigured: Boolean(process.env.STRIPE_PRICE_ADVENTURER_YEARLY),
    guildmasterMonthlyConfigured: Boolean(process.env.STRIPE_PRICE_GUILDMASTER_MONTHLY),
    guildmasterYearlyConfigured: Boolean(process.env.STRIPE_PRICE_GUILDMASTER_YEARLY),
    publicSiteUrl: process.env.PUBLIC_SITE_URL || ''
  });
});

app.post(['/create-checkout-session', '/api/create-checkout-session'], async (req, res) => {
  try {
    const stripe = getStripe();
    const { planId, billingInterval, userId, email, name, returnUrl } = req.body || {};
    const uid = String(userId || '').trim();
    const safePlan = normalizePlan(planId);
    const safeInterval = normalizeInterval(billingInterval);
    if (!uid || safePlan === 'free') return res.status(400).json({ error: 'Missing user ID or paid plan.' });

    const priceEnv = priceEnvByPlan[safePlan][safeInterval];
    const priceId = process.env[priceEnv];
    if (!priceId) return res.status(500).json({ error: `Missing ${priceEnv} environment variable.` });

    const customerId = await getOrCreateStripeCustomer(stripe, { uid, email, name });
    const origin = siteOrigin(req, returnUrl);
    const successUrl = new URL('/subscription-complete', origin);
    successUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
    const cancelUrl = new URL('/', origin);
    cancelUrl.searchParams.set('stripe_cancelled', 'true');

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: uid,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      metadata: { userId: uid, firebaseUID: uid, planId: safePlan, billingInterval: safeInterval },
      subscription_data: { metadata: { userId: uid, firebaseUID: uid, planId: safePlan, billingInterval: safeInterval } },
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString()
    });

    await db.collection('users').doc(uid).set({
      pendingStripePlan: safePlan,
      pendingStripeBillingInterval: safeInterval,
      pendingStripeStartedAt: new Date().toISOString(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return res.json({ url: session.url, sessionId: session.id, stripeCustomerId: customerId });
  } catch (error) {
    console.error('Create checkout session failed:', error);
    return res.status(500).json({ error: error.message || 'Unable to start Stripe Checkout.' });
  }
});

app.get(['/confirm-checkout-session', '/api/confirm-checkout-session'], async (req, res) => {
  try {
    const stripe = getStripe();
    const sessionId = String(req.query.session_id || '').trim();
    if (!sessionId) return res.status(400).json({ error: 'Missing session_id.' });

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription', 'line_items.data.price.product'] });
    const subscription = typeof session.subscription === 'object' ? session.subscription : null;
    const paid = session.payment_status === 'paid' && subscription && ['active', 'trialing'].includes(subscription.status);
    if (!paid) return res.status(402).json({ active: false, error: 'Stripe checkout is not paid/active yet.' });

    await applyCheckoutSession(session);
    return res.json({
      active: true,
      userId: session.client_reference_id || session.metadata?.userId || session.metadata?.firebaseUID || '',
      planId: normalizePlan(session.metadata?.planId || subscription.metadata?.planId),
      billingInterval: normalizeInterval(session.metadata?.billingInterval || subscription.metadata?.billingInterval),
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id || '',
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      stripeCheckoutSessionId: session.id
    });
  } catch (error) {
    console.error('Confirm checkout session failed:', error);
    return res.status(500).json({ error: error.message || 'Unable to confirm Stripe checkout.' });
  }
});

async function applyCheckoutSession(session) {
  const stripe = getStripe();
  const subscription = typeof session.subscription === 'string'
    ? await stripe.subscriptions.retrieve(session.subscription, { expand: ['items.data.price.product'] })
    : session.subscription;
  const uid = session.client_reference_id || session.metadata?.userId || session.metadata?.firebaseUID || subscription?.metadata?.userId || subscription?.metadata?.firebaseUID;
  if (!uid || !subscription || !['active', 'trialing'].includes(subscription.status)) return;
  await applySubscription(subscription, { uid, checkoutSessionId: session.id });
}

function planFromSubscription(subscription) {
  const metaPlan = normalizePlan(subscription.metadata?.planId);
  if (metaPlan !== 'free') return metaPlan;
  const item = subscription.items?.data?.[0];
  const product = item?.price?.product;
  const text = `${item?.price?.nickname || ''} ${item?.price?.lookup_key || ''} ${typeof product === 'object' ? `${product.name || ''} ${product.description || ''}` : ''}`.toLowerCase();
  if (text.includes('guild')) return 'guildmaster';
  if (text.includes('advent')) return 'adventurer';
  return 'free';
}

function intervalFromSubscription(subscription) {
  return normalizeInterval(subscription.items?.data?.[0]?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly');
}

async function applySubscription(subscription, extra = {}) {
  const uid = extra.uid || subscription.metadata?.userId || subscription.metadata?.firebaseUID;
  if (!uid) return;
  const active = ['active', 'trialing'].includes(subscription.status);
  const plan = active ? planFromSubscription(subscription) : 'free';
  const billingInterval = intervalFromSubscription(subscription);
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || '';
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.collection('customers').doc(uid).set({
    uid,
    stripeId: customerId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    subscriptionStatus: subscription.status,
    plan,
    billingInterval,
    active,
    updatedAt: now
  }, { merge: true });

  await db.collection('customers').doc(uid).collection('subscriptions').doc(subscription.id).set({
    id: subscription.id,
    status: subscription.status,
    stripeSubscriptionStatus: subscription.status,
    stripeCustomerId: customerId,
    plan,
    billingInterval,
    active,
    updatedAt: now
  }, { merge: true });

  await db.collection('users').doc(uid).set({
    plan,
    billingInterval,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    pendingStripePlan: 'free',
    pendingStripeBillingInterval: 'monthly',
    pendingStripeStartedAt: '',
    updatedAt: now
  }, { merge: true });
}

exports.api = onRequest(
  {
    region: "us-central1",
    secrets: [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_ADVENTURER_MONTHLY",
      "STRIPE_PRICE_ADVENTURER_YEARLY",
      "STRIPE_PRICE_GUILDMASTER_MONTHLY",
      "STRIPE_PRICE_GUILDMASTER_YEARLY",
      "PUBLIC_SITE_URL"
    ]
  },
  app
);