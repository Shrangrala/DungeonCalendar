const Stripe = require('stripe');
const admin = require('firebase-admin');


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
    console.warn('Could not initialize Firebase Admin for Stripe subscription lookup:', error.message);
    return null;
  }
}

async function getStoredStripeCustomerId(db, userId) {
  if (!db || !userId) return '';
  const [userSnap, customerSnap] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('customers').doc(userId).get()
  ]);
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const customerData = customerSnap.exists ? customerSnap.data() || {} : {};
  return customerData.stripeCustomerId || customerData.customerId || customerData.stripeId || userData.stripeCustomerId || userData.customerId || userData.stripeId || '';
}

async function saveStripeStatusToFirestore(db, userId, data) {
  if (!db || !userId || !data?.customerId) return;
  const update = {
    plan: data.plan || 'free',
    billingInterval: data.billingInterval || 'monthly',
    stripeCustomerId: data.customerId,
    customerId: data.customerId,
    stripeSubscriptionId: data.subscriptionId || '',
    stripeSubscriptionStatus: data.status || '',
    stripeVerifiedEmail: data.email || '',
    stripeVerifiedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await Promise.all([
    db.collection('users').doc(userId).set(update, { merge: true }),
    db.collection('customers').doc(userId).set(update, { merge: true })
  ]);
}

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function normalizePlan(planId = 'free') {
  const value = String(planId || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['guildmaster', 'guild', 'guildmasterplan', 'guildplan'].includes(value)) return 'guildmaster';
  if (['adventurer', 'adventure', 'adventurerplan', 'adventureplan'].includes(value)) return 'adventurer';
  if (['free', 'freeplan', 'basic', 'starter'].includes(value)) return 'free';
  return 'free';
}

function normalizeBillingInterval(interval = 'monthly') {
  const value = String(interval || '').trim().toLowerCase();
  return value === 'yearly' || value === 'year' || value === 'annual' ? 'yearly' : 'monthly';
}

function planFromText(text = '') {
  const lower = String(text).toLowerCase();
  if (lower.includes('guildmaster') || lower.includes('guild master') || lower.includes('guild')) return 'guildmaster';
  if (lower.includes('adventurer') || lower.includes('adventure')) return 'adventurer';
  return 'free';
}

function inferPlanFromPrice(price, product, expectedPlan = 'free') {
  const text = [
    price?.nickname,
    price?.lookup_key,
    price?.id,
    product?.name,
    product?.description,
    product?.metadata?.plan,
    price?.metadata?.plan
  ].filter(Boolean).join(' ');

  const textPlan = planFromText(text);
  if (textPlan !== 'free') return textPlan;

  const amount = Number(price?.unit_amount || 0);
  if (amount === 499 || amount === 4999 || amount >= 4900) return 'guildmaster';
  if (amount === 299 || amount === 2999) return 'adventurer';

  // Payment Links can show "already subscribed" and still not expose a name we can infer reliably.
  // If the app sent the selected plan, use that as a safe fallback once Stripe confirms an active subscription exists.
  return normalizePlan(expectedPlan);
}

function inferBillingInterval(price, expectedBillingInterval = 'monthly') {
  const interval = price?.recurring?.interval;
  if (interval === 'year') return 'yearly';
  if (interval === 'month') return 'monthly';
  return normalizeBillingInterval(expectedBillingInterval);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'STRIPE_SECRET_KEY is not configured.' }));
    return;
  }

  const body = req.body || {};
  const email = normalizeEmail(req.query?.email || body.email || '');
  const userId = String(req.query?.userId || body.userId || '').trim();
  const expectedPlan = normalizePlan(req.query?.expectedPlan || body.expectedPlan || 'free');
  const expectedBillingInterval = normalizeBillingInterval(req.query?.expectedBillingInterval || body.expectedBillingInterval || 'monthly');

  if (!email) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing billing email.' }));
    return;
  }

  try {
    const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });
    const db = initFirebaseAdmin();
    const storedCustomerId = await getStoredStripeCustomerId(db, userId);
    let customers = [];

    if (storedCustomerId) {
      try {
        const customer = await stripe.customers.retrieve(storedCustomerId);
        if (customer && !customer.deleted) customers.push(customer);
      } catch (error) {
        console.warn(`Stored Stripe customer ${storedCustomerId} could not be retrieved during verification:`, error.message);
      }
    }

    if (!customers.length && userId) {
      const uidMatches = await stripe.customers.search({
        query: `metadata['firebaseUid']:'${String(userId).replace(/'/g, "\'")}'`,
        limit: 5
      });
      customers = uidMatches.data || [];
    }

    if (!customers.length) {
      const emailMatches = await stripe.customers.list({ email, limit: 5 });
      customers = emailMatches.data || [];
    }

    let best = null;

    for (const customer of customers || []) {
      const subscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 20,
        expand: ['data.items.data.price.product']
      });

      for (const subscription of subscriptions.data || []) {
        if (!['active', 'trialing', 'past_due'].includes(subscription.status)) continue;

        const item = subscription.items?.data?.[0];
        const price = item?.price;
        let product = null;

        if (price?.product && typeof price.product === 'object') {
          product = price.product;
        } else if (price?.product && typeof price.product === 'string') {
          try {
            product = await stripe.products.retrieve(price.product);
          } catch (productError) {
            console.warn('Stripe product lookup failed; continuing with price-only plan inference:', productError?.message || productError);
          }
        }

        const plan = inferPlanFromPrice(price, product, expectedPlan);
        if (plan === 'free') continue;

        const candidate = {
          active: true,
          plan,
          billingInterval: inferBillingInterval(price, expectedBillingInterval),
          email,
          customerId: customer.id,
          subscriptionId: subscription.id,
          status: subscription.status,
          priceId: price?.id || '',
          productName: product?.name || '',
          currentPeriodEnd: subscription.current_period_end || null,
          created: subscription.created || 0
        };

        if (!best || candidate.created > best.created) best = candidate;
      }
    }

    if (!best) {
      res.statusCode = 200;
      res.end(JSON.stringify({
        active: false,
        plan: 'free',
        billingInterval: 'monthly',
        email,
        message: 'No active paid subscription found for that billing email. Use the same email shown on the Stripe subscription page.'
      }));
      return;
    }

    delete best.created;
    await saveStripeStatusToFirestore(db, userId, best);
    res.statusCode = 200;
    res.end(JSON.stringify(best));
  } catch (error) {
    console.error('Stripe subscription lookup failed:', error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error.message || 'Stripe subscription lookup failed.' }));
  }
};
