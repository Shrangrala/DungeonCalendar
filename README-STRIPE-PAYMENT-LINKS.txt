Dungeon Calendar now uses direct Stripe Payment Links.

The app no longer calls /api/create-checkout-session or any Vercel API route for checkout.
Plan buttons open the matching Stripe-hosted payment page directly:
- Adventurer monthly
- Adventurer yearly
- Guildmaster monthly
- Guildmaster yearly

Because Payment Links are used directly, these backend env vars are not required for checkout:
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- STRIPE_PRICE_*

Important:
Stripe Payment Links by themselves do not automatically update Firestore after payment unless you later add a webhook or Stripe customer portal integration. The current frontend sends users to the correct Stripe payment page and includes prefilled_email and client_reference_id query values where Stripe accepts them.
