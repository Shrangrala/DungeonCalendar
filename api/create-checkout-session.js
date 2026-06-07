const allowedOrigins = [
  "https://www.dungeoncalendar.com",
  "https://dungeoncalendar.com",
  "https://dungeoncalendarmobile.vercel.app"
];

function isAllowedOrigin(origin = "") {
  return allowedOrigins.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
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

function normalizeUrl(url = "") {
  return String(url || "").replace(/\/$/, "");
}

function getRequestBaseUrl(req) {
  const configured = process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return normalizeUrl(configured);
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function getCheckoutReturnBaseUrl(req, requestedReturnUrl) {
  const explicitReturnUrl = normalizeUrl(requestedReturnUrl);
  if (explicitReturnUrl && isAllowedOrigin(explicitReturnUrl)) {
    return explicitReturnUrl;
  }

  const origin = normalizeUrl(req.headers.origin);
  if (origin && isAllowedOrigin(origin)) {
    return origin;
  }

  return getRequestBaseUrl(req);
}

const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-11-17.clover"
});

const priceEnvByPlan = {
  adventurer: {
    monthly: "STRIPE_PRICE_ADVENTURER_MONTHLY",
    yearly: "STRIPE_PRICE_ADVENTURER_YEARLY"
  },
  guildmaster: {
    monthly: "STRIPE_PRICE_GUILDMASTER_MONTHLY",
    yearly: "STRIPE_PRICE_GUILDMASTER_YEARLY"
  }
};

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY environment variable." });
  }

  try {
    const { planId, billingInterval, userId, email, name, returnUrl } = req.body || {};
    const safePlan = ["adventurer", "guildmaster"].includes(planId) ? planId : "";
    const safeInterval = ["monthly", "yearly"].includes(billingInterval) ? billingInterval : "";

    if (!safePlan || !safeInterval || !userId) {
      return res.status(400).json({ error: "Missing plan, billing interval, or user ID." });
    }

    const envName = priceEnvByPlan[safePlan][safeInterval];
    const priceId = process.env[envName];

    if (!priceId) {
      return res.status(500).json({ error: `Missing ${envName} environment variable.` });
    }

    const checkoutReturnBaseUrl = getCheckoutReturnBaseUrl(req, returnUrl);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: [
        "card",
        "link",
        "us_bank_account",
        "cashapp",
        "amazon_pay"
      ],
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer_email: email || undefined,
      client_reference_id: userId,
      metadata: {
        userId,
        planId: safePlan,
        billingInterval: safeInterval,
        name: name || ""
      },
      subscription_data: {
        metadata: {
          userId,
          planId: safePlan,
          billingInterval: safeInterval
        }
      },
      success_url: `${checkoutReturnBaseUrl}/?stripe_success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${checkoutReturnBaseUrl}/?stripe_cancelled=true&checkout_cancelled=true`
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout session error:", error);
    return res.status(500).json({ error: error.message || "Unable to start Stripe Checkout." });
  }
};
