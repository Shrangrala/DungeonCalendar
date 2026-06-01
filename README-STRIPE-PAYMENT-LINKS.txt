Dungeon Calendar Stripe Payment Links

The Billing page now redirects directly to Stripe Payment Links instead of calling the checkout-session API.

Configured links:
- Adventurer Monthly: https://buy.stripe.com/9B68wPb7s55jcGn7XE6Ri01
- Adventurer Yearly: https://buy.stripe.com/9B6cN53F0fJXayfcdU6Ri03
- Guildmaster Monthly: https://buy.stripe.com/8x28wP0sO8hvbCja5M6Ri00
- Guildmaster Yearly: https://buy.stripe.com/cNi5kDfnI2Xb9ub2Dk6Ri02

Notes:
- The user chooses Adventurer or Guildmaster, then Monthly or Yearly.
- Continue to Stripe opens the corresponding payment link.
- Stripe receives prefilled_email and client_reference_id when available.
- Because Payment Links are hosted by Stripe, no STRIPE_SECRET_KEY is needed for this redirect flow.
