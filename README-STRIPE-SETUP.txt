Dungeon Calendar Stripe setup

1. In Stripe Dashboard, create four recurring prices:
   - Adventurer monthly: $2.99/month
   - Adventurer yearly: $29.99/year
   - Guildmaster monthly: $4.99/month
   - Guildmaster yearly: $49.99/year

2. In Vercel Project Settings > Environment Variables, add:
   STRIPE_SECRET_KEY=sk_test_...                 (new rotated secret key only)
   STRIPE_PRICE_ADVENTURER_MONTHLY=price_...
   STRIPE_PRICE_ADVENTURER_YEARLY=price_...
   STRIPE_PRICE_GUILDMASTER_MONTHLY=price_...
   STRIPE_PRICE_GUILDMASTER_YEARLY=price_...
   PUBLIC_SITE_URL=https://dungeoncalendar.com

3. For reliable subscription cancellation/downgrade sync, add a Stripe webhook:
   Endpoint URL: https://dungeoncalendar.com/api/stripe-webhook
   Events:
   - checkout.session.completed
   - customer.subscription.updated
   - customer.subscription.deleted

4. Add the webhook signing secret in Vercel:
   STRIPE_WEBHOOK_SECRET=whsec_...

5. Add one Firebase Admin credential env var in Vercel for the webhook:
   FIREBASE_SERVICE_ACCOUNT_JSON={...full service account json...}
   OR
   FIREBASE_SERVICE_ACCOUNT_BASE64=<base64 encoded service account json>

6. Redeploy Vercel after adding env vars.

Important:
- Never put STRIPE_SECRET_KEY in React/frontend code.
- The publishable key is not required for this Stripe Checkout redirect flow.
