Stripe + Firestore repair

This build fixes the Stripe subscription verification endpoint error:

  You cannot expand more than 4 levels of a property: data.items.data.price.product

The endpoint no longer uses that nested Stripe expansion. It lists subscriptions normally and retrieves the Stripe product separately when needed.

It also changes Firebase Firestore initialization to use auto-detected long polling for web browsers. This helps with FirebaseError: Failed to get document because the client is offline, which can happen when the browser/network blocks Firestore WebChannel streaming.

Required Vercel environment variable:
  STRIPE_SECRET_KEY=your current rotated Stripe secret key

Redeploy with Clear Build Cache after replacing the files.
