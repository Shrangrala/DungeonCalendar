const allowedOrigins = [
  "https://www.dungeoncalendar.com",
  "https://dungeoncalendar.com",
  "https://dungeon-calendar-app.web.app"
];

function isAllowedOrigin(origin = "") {
  return allowedOrigins.includes(origin);
}

function setCors(req, res) {
  const origin = req.headers.origin;

  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const Stripe = require('stripe');
const admin = require('firebase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20'
});

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

function initFirebaseAdmin() {
  if (admin.apps.length) return admin.firestore();

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (!rawJson && !rawBase64) return null;

  const jsonText = rawJson || Buffer.from(rawBase64, 'base64').toString('utf8');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(jsonText)) });
  return admin.firestore();
}

function normalizeEmail(email = '') {
  return String(email || '').trim().toLowerCase();
}

function getBaseUrl(req) {
  const configured = process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function safeReturnUrl(req, returnUrl) {
  const fallback = getBaseUrl(req);
  const raw = String(returnUrl || '').trim();
  if (!raw) return fallback;

  try {
    const parsed = new URL(raw);
    const origin = parsed.origin;
    if (isAllowedOrigin(origin)) return origin;
  } catch {
    // Ignore invalid URLs and use fallback.
  }

  return fallback;
}

function readStripeCustomerId(data = {}) {
  return String(data.stripeCustomerId || data.customerId || data.stripeId || '').trim();
}

async function getFirestoreCustomerId(db, userId) {
  if (!db || !userId) return '';

  const [userSnap, customerSnap] = await Promise.all([
    db.collection('users').doc(userId).get().catch(() => null),
    db.collection('customers').doc(userId).get().catch(() => null)
  ]);

  return readStripeCustomerId(userSnap?.data?.() || {}) || readStripeCustomerId(customerSnap?.data?.() || {});
}

async function findStripeCustomerByEmailAndUid(email, userId) {
  if (!email) return '';

  const customers = await stripe.customers.list({ email, limit: 100 });
  const liveCustomers = (customers.data || []).filter((customer) => !customer.deleted);

  const metadataMatch = liveCustomers.find((customer) => {
    const meta = customer.metadata || {};
    return [meta.userId, meta.uid, meta.firebaseUid, meta.firebaseUID, meta.firebaseUserId].filter(Boolean).includes(userId);
  });
  if (metadataMatch) return metadataMatch.id;

  const withoutSubscription = [];
  for (const customer of liveCustomers) {
    const subscriptions = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 3 });
    if ((subscriptions.data || []).some((subscription) => ['active', 'trialing', 'past_due', 'unpaid'].includes(subscription.status))) {
      return customer.id;
    }
    withoutSubscription.push(customer);
  }

  return withoutSubscription[0]?.id || '';
}

async function ensureLinkedStripeCustomer({ db, userId, email, name }) {
  let customerId = await getFirestoreCustomerId(db, userId);

  if (customerId) {
    try {
      const existing = await stripe.customers.retrieve(customerId);
      if (!existing || existing.deleted) customerId = '';
    } catch {
      customerId = '';
    }
  }

  if (!customerId) {
    customerId = await findStripeCustomerByEmailAndUid(email, userId);
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: email || undefined,
      name: name || undefined,
      metadata: {
        userId,
        uid: userId,
        firebaseUid: userId,
        firebaseUID: userId
      }
    });
    customerId = customer.id;
  } else {
    await stripe.customers.update(customerId, {
      email: email || undefined,
      name: name || undefined,
      metadata: {
        userId,
        uid: userId,
        firebaseUid: userId,
        firebaseUID: userId
      }
    });
  }

  if (db && userId && customerId) {
    const data = {
      email: email || undefined,
      stripeId: customerId,
      stripeCustomerId: customerId,
      stripeLink: `https://dashboard.stripe.com/customers/${customerId}`,
      updatedAt: new Date().toISOString()
    };
    const cleanData = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
    await Promise.all([
      db.collection('users').doc(userId).set(cleanData, { merge: true }),
      db.collection('customers').doc(userId).set(cleanData, { merge: true })
    ]);
  }

  return customerId;
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY environment variable.' });
  }

  try {
    const { planId, billingInterval, userId, email, name, returnUrl } = req.body || {};
    const safePlan = ['adventurer', 'guildmaster'].includes(planId) ? planId : '';
    const safeInterval = ['monthly', 'yearly'].includes(billingInterval) ? billingInterval : '';
    const safeUserId = String(userId || '').trim();
    const safeEmail = normalizeEmail(email);

    if (!safePlan || !safeInterval || !safeUserId) {
      return res.status(400).json({ error: 'Missing plan, billing interval, or user ID.' });
    }

    const envName = priceEnvByPlan[safePlan][safeInterval];
    const priceId = process.env[envName];

    if (!priceId) {
      return res.status(500).json({ error: `Missing ${envName} environment variable.` });
    }

    const db = initFirebaseAdmin();
    const stripeCustomerId = await ensureLinkedStripeCustomer({ db, userId: safeUserId, email: safeEmail, name });

    const appReturnUrl = safeReturnUrl(req, returnUrl);
    const successUrl = new URL('/subscription-complete', appReturnUrl);
    successUrl.searchParams.set('stripe_success', 'true');
    successUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
    successUrl.searchParams.set('stripe_plan', safePlan);
    successUrl.searchParams.set('stripe_billing', safeInterval);

    const cancelUrl = new URL(appReturnUrl);
    cancelUrl.searchParams.set('stripe_cancelled', 'true');
    cancelUrl.searchParams.set('checkout_cancelled', 'true');

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer: stripeCustomerId,
      client_reference_id: safeUserId,
      customer_update: {
        name: 'auto',
        address: 'auto'
      },
      metadata: {
        userId: safeUserId,
        uid: safeUserId,
        firebaseUid: safeUserId,
        firebaseUID: safeUserId,
        planId: safePlan,
        billingInterval: safeInterval,
        name: name || ''
      },
      subscription_data: {
        metadata: {
          userId: safeUserId,
          uid: safeUserId,
          firebaseUid: safeUserId,
          firebaseUID: safeUserId,
          planId: safePlan,
          billingInterval: safeInterval
        }
      },
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString()
    });

    return res.status(200).json({ url: session.url, customerId: stripeCustomerId });
  } catch (error) {
    console.error('Stripe checkout session error:', error);
    return res.status(500).json({ error: error.message || 'Unable to start Stripe Checkout.' });
  }
};
