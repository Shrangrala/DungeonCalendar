const Stripe = require('stripe');

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function planFromText(text = '') {
  const lower = String(text).toLowerCase();
  if (lower.includes('guild')) return 'guildmaster';
  if (lower.includes('master')) return 'guildmaster';
  if (lower.includes('adventurer')) return 'adventurer';
  return '';
}

function inferPlanFromPrice(price, product) {
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
  if (textPlan) return textPlan;

  const amount = Number(price?.unit_amount || 0);
  // Fallback for current Dungeon Calendar prices:
  // Adventurer: 2.99 monthly / 29.99 yearly. Guildmaster: 4.99 monthly / 49.99 yearly.
  if (amount >= 4900 || amount === 499) return 'guildmaster';
  if (amount >= 299 || amount === 2999) return 'adventurer';
  return 'free';
}

function inferBillingInterval(price) {
  const interval = price?.recurring?.interval;
  return interval === 'year' ? 'yearly' : 'monthly';
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

  const email = normalizeEmail(req.query?.email || req.body?.email || '');
  if (!email) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing billing email.' }));
    return;
  }

  try {
    const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });
    const customers = await stripe.customers.list({ email, limit: 10 });

    let best = null;

    for (const customer of customers.data || []) {
      const subscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 20,
        expand: ['data.items.data.price.product']
      });

      for (const subscription of subscriptions.data || []) {
        if (!['active', 'trialing'].includes(subscription.status)) continue;

        const item = subscription.items?.data?.[0];
        const price = item?.price;
        const product = price && typeof price.product === 'object' ? price.product : null;
        const plan = inferPlanFromPrice(price, product);
        if (plan === 'free') continue;

        const candidate = {
          active: true,
          plan,
          billingInterval: inferBillingInterval(price),
          email,
          customerId: customer.id,
          subscriptionId: subscription.id,
          status: subscription.status,
          priceId: price?.id || '',
          productName: product?.name || '',
          currentPeriodEnd: subscription.current_period_end || null
        };

        if (!best || (subscription.created || 0) > (best.created || 0)) {
          best = { ...candidate, created: subscription.created || 0 };
        }
      }
    }

    if (!best) {
      res.statusCode = 200;
      res.end(JSON.stringify({
        active: false,
        plan: 'free',
        billingInterval: 'monthly',
        email,
        message: 'No active paid subscription found for that billing email.'
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
