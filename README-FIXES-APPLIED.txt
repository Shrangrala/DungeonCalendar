Dungeon Calendar consolidated fix

Applied fixes:
- Stripe paid plan buttons now redirect directly to the matching Stripe Payment Link.
- Firestore pending-plan save no longer blocks the Stripe redirect.
- Billing email must match the signed-in Dungeon Calendar email before checkout/activation.
- Already-subscribed/manual activation verifies the saved pending checkout belongs to the current signed-in user.
- Coupon-code checkouts activate the selected plan level, because coupon price does not change the app plan tier.
- Profile settings email fallback was fixed so blank/whitespace email fields do not break saving.

Stripe setup:
Use direct Payment Links only. Set each Stripe Payment Link success URL to one of:
https://dungeoncalendar.com/?stripe_success=true&stripe_plan=adventurer&stripe_billing=monthly
https://dungeoncalendar.com/?stripe_success=true&stripe_plan=adventurer&stripe_billing=yearly
https://dungeoncalendar.com/?stripe_success=true&stripe_plan=guildmaster&stripe_billing=monthly
https://dungeoncalendar.com/?stripe_success=true&stripe_plan=guildmaster&stripe_billing=yearly

If Stripe shows "already have a subscription", return to Dungeon Calendar and use the Activate button shown for the selected/pending plan.
