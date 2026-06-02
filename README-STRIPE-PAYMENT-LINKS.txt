Dungeon Calendar uses direct Stripe Payment Links for checkout.

No Vercel Stripe Integration is required.
No /api/create-checkout-session route is required.
No Stripe secret key is required for checkout.

IMPORTANT: Configure each Stripe Payment Link to redirect back to a plan-specific success URL:

Adventurer monthly:
https://dungeoncalendar.com/?stripe_success=true&stripe_plan=adventurer&stripe_billing=monthly

Adventurer yearly:
https://dungeoncalendar.com/?stripe_success=true&stripe_plan=adventurer&stripe_billing=yearly

Guildmaster monthly:
https://dungeoncalendar.com/?stripe_success=true&stripe_plan=guildmaster&stripe_billing=monthly

Guildmaster yearly:
https://dungeoncalendar.com/?stripe_success=true&stripe_plan=guildmaster&stripe_billing=yearly

Recommended cancel URL for all links:
https://dungeoncalendar.com/?stripe_cancelled=true

The app also saves a pending plan before sending the user to Stripe. If Stripe returns without the plan parameters, the Billing page shows an Activate Paid Plan button for the pending selection.
