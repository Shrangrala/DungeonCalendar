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

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer_email: email || undefined,
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
