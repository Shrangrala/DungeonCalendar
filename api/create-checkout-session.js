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


function initFirebaseAdmin() {
  if (admin.apps.length) return admin.firestore();

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (!rawJson && !rawBase64) {
    return null;
  }

  try {
    const jsonText = rawJson || Buffer.from(rawBase64, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(jsonText);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    return admin.firestore();
  } catch (error) {
    console.warn('Firebase Admin unavailable in create-checkout-session:', error.message);
    return null;
  }
}

function normalizeEmail(email = '') {
  return String(email || '').trim().toLowerCase();
}

async function findStripeCustomerByFirebaseUid(userId) {
  try {
    const result = await stripe.customers.search({
      query: `metadata['firebaseUID']:'${userId}' OR metadata['firebaseUid']:'${userId}' OR metadata['userId']:'${userId}' OR metadata['uid']:'${userId}'`,
      limit: 10
    });
    return result.data?.[0] || null;
  } catch (error) {
    console.warn('Stripe customer metadata search failed; continuing:', error.message);
    return null;
  }
}

async function getOrCreateLinkedStripeCustomer({ userId, email, name }) {
  const db = initFirebaseAdmin();
  const normalizedEmail = normalizeEmail(email);
  let existingCustomerId = '';

  if (db) {
    const [userSnap, customerSnap] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('customers').doc(userId).get()
    ]);
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const customerData = customerSnap.exists ? customerSnap.data() || {} : {};
    existingCustomerId = userData.stripeCustomerId || userData.stripeId || customerData.stripeCustomerId || customerData.stripeId || '';
  }

  if (existingCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(existingCustomerId);
      if (existing && !existing.deleted) {
        await stripe.customers.update(existingCustomerId, {
          email: normalizedEmail || existing.email || undefined,
          name: name || existing.name || undefined,
          metadata: {
            ...(existing.metadata || {}),
            userId,
            uid: userId,
            firebaseUID: userId,
            firebaseUid: userId
          }
        });
        return existingCustomerId;
      }
    } catch (error) {
      console.warn(`Stored Stripe customer ${existingCustomerId} could not be reused; searching/creating instead:`, error.message);
    }
  }

  const metadataMatch = await findStripeCustomerByFirebaseUid(userId);
  if (metadataMatch?.id) {
    existingCustomerId = metadataMatch.id;
  }

  if (!existingCustomerId && normalizedEmail) {
    const byEmail = await stripe.customers.list({ email: normalizedEmail, limit: 10 });
    const withFirebaseUid = byEmail.data?.find((customer) =>
      customer.metadata?.firebaseUID === userId ||
      customer.metadata?.firebaseUid === userId ||
      customer.metadata?.userId === userId ||
      customer.metadata?.uid === userId
    );
    existingCustomerId = withFirebaseUid?.id || byEmail.data?.[0]?.id || '';
  }

  if (!existingCustomerId) {
    const created = await stripe.customers.create({
      email: normalizedEmail || undefined,
      name: name || undefined,
      metadata: {
        userId,
        uid: userId,
        firebaseUID: userId,
        firebaseUid: userId
      }
    });
    existingCustomerId = created.id;
  } else {
    const existing = await stripe.customers.retrieve(existingCustomerId);
    if (existing && !existing.deleted) {
      await stripe.customers.update(existingCustomerId, {
        email: normalizedEmail || existing.email || undefined,
        name: name || existing.name || undefined,
        metadata: {
          ...(existing.metadata || {}),
          userId,
          uid: userId,
          firebaseUID: userId,
          firebaseUid: userId
        }
      });
    }
  }

  if (db && existingCustomerId) {
    const data = {
      email: normalizedEmail || email || '',
      stripeId: existingCustomerId,
      stripeCustomerId: existingCustomerId,
      stripeLink: `https://dashboard.stripe.com/customers/${existingCustomerId}`,
      updatedAt: new Date().toISOString()
    };
    await Promise.all([
      db.collection('users').doc(userId).set(data, { merge: true }),
      db.collection('customers').doc(userId).set(data, { merge: true })
    ]);
  }

  return existingCustomerId;
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

    const stripeCustomerId = await getOrCreateLinkedStripeCustomer({ userId, email, name });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer: stripeCustomerId,
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

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Stripe checkout session error:', error);
    return res.status(500).json({ error: error.message || 'Unable to start Stripe Checkout.' });
  }
};
