const admin = require('firebase-admin');

function initFirebaseAdmin() {
  if (admin.apps.length) return admin;
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!rawJson && !rawBase64) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64.');
  }
  const jsonText = rawJson || Buffer.from(rawBase64, 'base64').toString('utf8');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(jsonText)) });
  return admin;
}

function firstTruthy(values) {
  for (const value of values) {
    if (value) return String(value);
  }
  return '';
}

function normalizeCampaignSingleDm(data = {}) {
  const dmId = firstTruthy([
    data.dungeonMasterId,
    data.dmId,
    data.ownerId,
    data.createdBy,
    ...(Array.isArray(data.dungeonMasterIds) ? data.dungeonMasterIds : [])
  ]);
  return {
    ownerId: dmId || data.ownerId || '',
    dungeonMasterId: dmId,
    dmId,
    dungeonMasterIds: dmId ? [dmId] : []
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (!['POST', 'GET'].includes(req.method)) {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }

  try {
    const firebaseAdmin = initFirebaseAdmin();
    const db = firebaseAdmin.firestore();
    const snapshot = await db.collection('campaigns').get();
    const batch = db.batch();
    let checked = 0;
    let cleaned = 0;

    snapshot.forEach((docSnap) => {
      checked += 1;
      const data = docSnap.data() || {};
      const next = normalizeCampaignSingleDm(data);
      const currentIds = Array.isArray(data.dungeonMasterIds) ? data.dungeonMasterIds.filter(Boolean).map(String) : [];
      const needsCleanup =
        currentIds.length !== next.dungeonMasterIds.length ||
        currentIds[0] !== next.dungeonMasterIds[0] ||
        data.ownerId !== next.ownerId ||
        data.dungeonMasterId !== next.dungeonMasterId ||
        data.dmId !== next.dmId;
      if (needsCleanup) {
        cleaned += 1;
        batch.set(docSnap.ref, { ...next, updatedAt: new Date().toISOString(), singleDmCleanupAt: new Date().toISOString() }, { merge: true });
      }
    });

    if (cleaned > 0) await batch.commit();
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, checked, cleaned, rule: 'Each campaign now has exactly one dungeonMasterId and dungeonMasterIds has max one value.' }));
  } catch (error) {
    console.error('Single DM cleanup failed:', error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error.message || 'Single DM cleanup failed.' }));
  }
};
