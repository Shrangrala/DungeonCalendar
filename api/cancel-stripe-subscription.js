const Stripe = require('stripe');
const admin = require('firebase-admin');

function initFirebaseAdmin() {
  if (admin.apps.length) return admin;

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (!rawJson && !rawBase64) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable. This is required to verify the signed-in Firebase user before cancelling Stripe subscriptions.');
  }

  const jsonText = rawJson || Buffer.from(rawBase64, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(jsonText);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin;
}

function normalizeEmail(email = '') {
  return String(email || '').trim().toLowerCase();
}

async function findActiveSubscription(stripe, { subscriptionId, customerId, email }) {
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (!['canceled', 'incomplete_expired'].includes(subscription.status)) return subscription;
  }

  const customerIds = [];
  if (customerId) customerIds.push(customerId);

  if (email) {
    const customers = await stripe.customers.list({ email, limit: 10 });
    for (const customer of customers.data || []) {
      if (!customerIds.includes(customer.id)) customerIds.push(customer.id);
    }
  }

  for (const id of customerIds) {
    const subscriptions = await stripe.subscriptions.list({
      customer: id,
      status: 'all',
      limit: 10
    });

    const active = (subscriptions.data || []).find((sub) =>
      ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(sub.status)
    );
    if (active) return active;
  }

  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'STRIPE_SECRET_KEY is not configured.' }));
    return;
  }

  try {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    const idToken = String(authHeader).startsWith('Bearer ') ? String(authHeader).slice(7) : '';
    if (!idToken) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'Missing Firebase ID token.' }));
      return;
    }

    const firebaseAdmin = initFirebaseAdmin();
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const signedInEmail = normalizeEmail(decoded.email || '');

    const body = req.body || {};
    const email = normalizeEmail(body.email || signedInEmail);
    if (signedInEmail && email && email !== signedInEmail) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: 'Subscription email does not match the signed-in Firebase account.' }));
      return;
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    const subscription = await findActiveSubscription(stripe, {
      subscriptionId: body.subscriptionId || '',
      customerId: body.customerId || '',
      email
    });

    if (!subscription) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'No active Stripe subscription found for this account.' }));
      return;
    }

    const canceled = await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });

    try {
      const db = firebaseAdmin.firestore();
      const periodEndIso = canceled.current_period_end
        ? new Date(canceled.current_period_end * 1000).toISOString()
        : '';
      const update = {
        stripeSubscriptionId: canceled.id,
        stripeCustomerId: canceled.customer || body.customerId || '',
        stripeSubscriptionStatus: canceled.status || 'active',
        stripeCancelAtPeriodEnd: Boolean(canceled.cancel_at_period_end),
        stripeCurrentPeriodEnd: periodEndIso,
        stripeCancellationRequestedAt: new Date().toISOString(),
        stripeCancellationSource: 'app_cancel_button',
        updatedAt: new Date().toISOString()
      };
      await Promise.all([
        db.collection('users').doc(decoded.uid).set(update, { merge: true }),
        db.collection('customers').doc(decoded.uid).set(update, { merge: true })
      ]);
    } catch (firestoreError) {
      console.warn('Stripe cancellation succeeded but Firestore update failed:', firestoreError?.message || firestoreError);
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      cancelled: false,
      cancelAtPeriodEnd: Boolean(canceled.cancel_at_period_end),
      currentPeriodEnd: canceled.current_period_end || null,
      subscriptionId: canceled.id,
      customerId: canceled.customer || '',
      status: canceled.status || 'active'
    }));
  } catch (error) {
    console.error('Stripe cancellation failed:', error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error.message || 'Stripe cancellation failed.' }));
  }
};
