Profile Fast Save Fix

This patch makes profile edits feel immediate:
- Save and Enter still trigger the same profile save function.
- The UI updates immediately after validation/auth updates.
- Firestore profile persistence runs in the background with a short timeout.
- The slow REST fallback is not used for normal profile saves anymore.
- If Firestore later rejects/times out, the user sees the real error message.
