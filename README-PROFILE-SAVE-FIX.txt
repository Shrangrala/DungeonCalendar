Dungeon Calendar - Profile Save Fix

This build repairs User Settings/Profile saving on the web app.

Changes:
- Save Changes now writes immediately when clicked.
- Pressing Enter inside profile fields now saves the account settings.
- Added a saving state to prevent duplicate submissions.
- If the Firestore Web SDK reports "client is offline", the app now retries the save through Firestore's REST API using the signed-in Firebase user's ID token.
- Profile save errors are surfaced more clearly in the Account Settings page.

Deployment:
- Replace the files in the Vercel/GitHub project with this package.
- Redeploy in Vercel with Clear Build Cache enabled.
- Make sure Firebase Authentication is signed in and Firestore rules allow a signed-in user to write users/{uid}.
