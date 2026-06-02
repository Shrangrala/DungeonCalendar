const Stripe = require('stripe');

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function normalizePlan(planId = 'free') {
  const value = String(planId || '').trim().toLowerCase();
  return ['free', 'adventurer', 'guildmaster'].includes(value) ? value : 'free';
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
    res.end(JSON.stringify({ error: 'STRIPE_SECRET_KEY is not configured in Vercel.' }));
    return;
  }

  const body = req.body || {};
  const email = normalizeEmail(req.query?.email || body.email || '');
  const expectedPlan = normalizePlan(req.query?.expectedPlan || body.expectedPlan || 'free');
  const expectedBillingInterval = normalizeBillingInterval(req.query?.expectedBillingInterval || body.expectedBillingInterval || 'monthly');

  if (!email) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing billing email.' }));
    return;
  }

  try {
    const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });
    const customers = await stripe.customers.list({ email, limit: 20 });

    let best = null;

    for (const customer of customers.data || []) {
      const subscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 50,
        expand: ['data.items.data.price.product']
      });

      for (const subscription of subscriptions.data || []) {
        if (!['active', 'trialing', 'past_due'].includes(subscription.status)) continue;

        const item = subscription.items?.data?.[0];
        const price = item?.price;
        const product = price && typeof price.product === 'object' ? price.product : null;
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
    res.statusCode = 200;
    res.end(JSON.stringify(best));
  } catch (error) {
    console.error('Stripe subscription lookup failed:', error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error.message || 'Stripe subscription lookup failed.' }));
  }
};
