Dungeon Calendar Main App - Profile/Plan Persistence + Faster Stripe Verification Fix

Changes in this package:
- Profile settings are cached immediately per Firebase user id so they are restored on every login, even if Firestore is temporarily slow/offline.
- Saved profile fields still write to Firestore for cross-device sync.
- Plan and billing interval are cached immediately and written to Firestore, so users do not need to reselect plans after logging in.
- Profile load now uses a 3-second Firestore timeout before falling back to the cached profile to avoid slow login/profile screens.
- Stripe existing-subscription verification now uses a 9-second browser timeout and a smaller Stripe lookup scope so it returns faster.
- Stripe verification still updates Firestore plan when a valid active subscription is found.

Deploy notes:
- Replace the current app files with this package.
- Keep STRIPE_SECRET_KEY set in Vercel.
- Redeploy with Clear Build Cache.
