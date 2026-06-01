Dungeon Calendar uses direct Stripe Payment Links for checkout.

No Vercel Stripe Integration is required.
No /api/create-checkout-session route is required.
No Stripe secret key is required for checkout.

Set each Stripe Payment Link success/confirmation redirect to:
https://dungeoncalendar.com/?stripe_success=true

Set each cancel redirect to:
https://dungeoncalendar.com/?stripe_cancelled=true

When a user clicks a paid plan, Dungeon Calendar saves the selected plan locally before sending them to Stripe. After Stripe redirects back with stripe_success=true, the app applies that pending plan to the signed-in user's Firestore profile.

Current direct payment links are wired in DungeonCalendarMainApp.js:
- Adventurer monthly
- Adventurer yearly
- Guildmaster monthly
- Guildmaster yearly
