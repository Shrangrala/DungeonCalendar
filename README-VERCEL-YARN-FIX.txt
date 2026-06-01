Vercel install fix

Replace your root package.json and vercel.json with these files.
Delete package-lock.json and pnpm-lock.yaml from the repo if they exist.
Commit and push.
In Vercel, redeploy with Clear Build Cache enabled.

This avoids the npm and pnpm installer failures by using Yarn Classic and keeps the Expo web output directory as dist.
