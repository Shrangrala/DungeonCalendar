Replace the root package.json with this package.json and add vercel.json to the repository root.

This bypasses the npm CLI bug seen on Vercel by forcing Vercel to install with pnpm instead of npm.

After copying these files:
1. Delete package-lock.json from the repository if it exists.
2. Commit package.json and vercel.json.
3. Push to GitHub.
4. In Vercel, redeploy with Clear Build Cache enabled.

The build output directory remains dist because Expo web export creates dist.
