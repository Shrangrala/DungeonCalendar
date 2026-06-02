Dungeon Calendar critical deployment notes

This build fixes two problems:
1. Profile settings saves now use a strict Firestore write so permission errors are shown instead of silently failing.
2. Stripe subscription activation now auto-checks the pending Stripe checkout when the user returns/focuses the app, and the Billing page includes both Stripe email verification and an Apply Pending Plan fallback.

Required Vercel environment variable:
STRIPE_SECRET_KEY=your current rotated Stripe secret key

Required Firestore rules for profile settings to save:
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}

After deploying:
1. Redeploy in Vercel with Clear Build Cache.
2. Log out and log back in.
3. Go to Billing. If Stripe already shows an active subscription, enter the same billing email and click Verify Stripe Subscription.
4. If Stripe redirects back but verification is delayed, use Apply Pending Plan in the green pending activation box.
