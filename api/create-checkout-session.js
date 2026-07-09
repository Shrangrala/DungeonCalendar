const allowedOrigins = [
  "https://www.dungeoncalendar.com",
  "https://www.dungeoncalendar.com",
  "https://dungeon-calendar-app.web.app"
];

function isAllowedOrigin(origin = "") {
  return allowedOrigins.includes(origin) ;
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


function initFirebaseAdmin() {
  if (admin.apps.length) return admin.firestore();

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (!rawJson && !rawBase64) return null;

  try {
    const jsonText = rawJson || Buffer.from(rawBase64, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(jsonText);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    return admin.firestore();
  } catch (error) {
    console.warn('Could not initialize Firebase Admin for Stripe customer reuse:', error.message);
    return null;
  }
}

async function getExistingStripeCustomerId(db, userId) {
  if (!db || !userId) return '';

  const [userSnap, customerSnap] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('customers').doc(userId).get()
  ]);

  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const customerData = customerSnap.exists ? customerSnap.data() || {} : {};
  return customerData.stripeCustomerId || customerData.customerId || customerData.stripeId || userData.stripeCustomerId || userData.customerId || userData.stripeId || '';
}

async function verifyStripeCustomer(customerId) {
  if (!customerId) return '';
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer && !customer.deleted ? customer.id : '';
  } catch (error) {
    console.warn(`Stored Stripe customer ${customerId} could not be retrieved; creating/reusing another customer.`, error.message);
    return '';
  }
}

async function findStripeCustomerByFirebaseUid(userId) {
  if (!userId) return '';
  const matches = await stripe.customers.search({
    query: `metadata['firebaseUid']:'${String(userId).replace(/'/g, "\\'")}'`,
    limit: 1
  });
  return matches.data?.[0]?.id || '';
}

async function findStripeCustomerByEmail(email) {
  if (!email) return '';
  const matches = await stripe.customers.list({ email, limit: 10 });
  const customer = (matches.data || []).find((item) => !item.deleted);
  return customer?.id || '';
}

async function getOrCreateStripeCustomer({ db, userId, email, name }) {
  let customerId = await verifyStripeCustomer(await getExistingStripeCustomerId(db, userId));
  if (!customerId) customerId = await findStripeCustomerByFirebaseUid(userId);
  if (!customerId) customerId = await findStripeCustomerByEmail(email);

  if (customerId) {
    await stripe.customers.update(customerId, {
      email: email || undefined,
      name: name || undefined,
      metadata: {
        userId,
        uid: userId,
        firebaseUid: userId
      }
    });
  } else {
    const customer = await stripe.customers.create({
      email: email || undefined,
      name: name || undefined,
      metadata: {
        userId,
        uid: userId,
        firebaseUid: userId
      }
    });
    customerId = customer.id;
  }

  if (db && customerId) {
    const update = {
      stripeCustomerId: customerId,
      customerId,
      stripeCustomerLinkedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await Promise.all([
      db.collection('users').doc(userId).set(update, { merge: true }),
      db.collection('customers').doc(userId).set({ ...update, email: email || '' }, { merge: true })
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

    if (!safePlan || !safeInterval || !userId) {
      return res.status(400).json({ error: 'Missing plan, billing interval, or user ID.' });
    }

    const envName = priceEnvByPlan[safePlan][safeInterval];
    const priceId = process.env[envName];

    if (!priceId) {
      return res.status(500).json({ error: `Missing ${envName} environment variable.` });
    }

    const appReturnUrl = safeReturnUrl(req, returnUrl);
    const successUrl = new URL('/subscription-complete', appReturnUrl);
    successUrl.searchParams.set('stripe_success', 'true');
    successUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
    successUrl.searchParams.set('stripe_plan', safePlan);
    successUrl.searchParams.set('stripe_billing', safeInterval);

    const cancelUrl = new URL(appReturnUrl);
    cancelUrl.searchParams.set('stripe_cancelled', 'true');
    cancelUrl.searchParams.set('checkout_cancelled', 'true');

    const db = initFirebaseAdmin();
    const customerId = await getOrCreateStripeCustomer({ db, userId, email, name });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer: customerId,
      client_reference_id: userId,
      metadata: {
        userId,
        planId: safePlan,
        billingInterval: safeInterval,
        name: name || ''
      },
      subscription_data: {
        metadata: {
          userId,
          planId: safePlan,
          billingInterval: safeInterval
        }
      },
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString()
    });

    return res.status(200).json({ url: session.url, stripeCustomerId: customerId });
  } catch (error) {
    console.error('Stripe checkout session error:', error);
    return res.status(500).json({ error: error.message || 'Unable to start Stripe Checkout.' });
  }
};
