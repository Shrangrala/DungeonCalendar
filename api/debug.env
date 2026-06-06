export default function handler(req, res) {
  res.status(200).json({
    hasStripeSecretKey: !!process.env.STRIPE_SECRET_KEY,
    hasStripeWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
    hasFirebaseServiceAccountJson: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    hasFirebaseServiceAccountBase64: !!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
  });
}