const admin = require('firebase-admin');

function initFirebaseAdmin() {
  if (admin.apps.length) return admin.firestore();
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!rawJson && !rawBase64) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64.');
  const jsonText = rawJson || Buffer.from(rawBase64, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(jsonText);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin.firestore();
}

function normalizeList(values = []) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values.map((value) => typeof value === 'string' ? value.trim() : value).filter(Boolean).filter((value) => {
    const key = typeof value === 'string' ? value : JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeEmail(email = '') {
  return String(email || '').trim().toLowerCase();
}

function playerKey(player = {}) {
  return normalizeEmail(player.email || '') || player.id || player.uid || '';
}

function normalizePlayers(players = []) {
  const seen = new Set();
  return (Array.isArray(players) ? players : []).filter((player) => {
    const key = playerKey(player);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeMap(map = {}) {
  return Object.fromEntries(Object.entries(map || {}).map(([key, ids]) => [key, normalizeList(ids)]).filter(([key, ids]) => key && ids.length));
}

function cleanCampaign(data = {}) {
  const ownerId = data.ownerId || '';
  return {
    dungeonMasterIds: normalizeList([...(data.dungeonMasterIds || []), ownerId, data.createdBy, data.dmId, data.dungeonMasterId].filter(Boolean)),
    memberIds: normalizeList(data.memberIds || data.playerIds || data.members || []),
    invitedEmails: normalizeList(data.invitedEmails || []).map(normalizeEmail).filter(Boolean),
    invitedPlayers: normalizePlayers(data.invitedPlayers || []),
    manuallySelectedDates: normalizeList(data.manuallySelectedDates || []),
    generatedSessionDates: normalizeList(data.generatedSessionDates || []),
    availability: normalizeMap(data.availability || {}),
    unavailable: normalizeMap(data.unavailable || {}),
    updatedAt: new Date().toISOString(),
    cleanupSource: 'cleanup-campaign-arrays'
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const expected = process.env.ADMIN_CLEANUP_TOKEN;
  if (expected && req.headers.authorization !== `Bearer ${expected}`) return res.status(401).json({ error: 'Unauthorized.' });

  try {
    const db = initFirebaseAdmin();
    const snapshot = await db.collection('campaigns').get();
    const batch = db.batch();
    let checked = 0;
    let updated = 0;

    snapshot.forEach((docSnap) => {
      checked += 1;
      const before = docSnap.data() || {};
      const after = cleanCampaign(before);
      const changed = ['dungeonMasterIds', 'memberIds', 'invitedEmails', 'invitedPlayers', 'manuallySelectedDates', 'generatedSessionDates', 'availability', 'unavailable']
        .some((field) => JSON.stringify(before[field] || (field === 'availability' || field === 'unavailable' ? {} : [])) !== JSON.stringify(after[field] || (field === 'availability' || field === 'unavailable' ? {} : [])));
      if (changed) {
        updated += 1;
        batch.set(docSnap.ref, after, { merge: true });
      }
    });

    if (updated) await batch.commit();
    return res.status(200).json({ ok: true, checked, updated });
  } catch (error) {
    console.error('Campaign cleanup failed:', error);
    return res.status(500).json({ error: error.message || 'Cleanup failed.' });
  }
};
