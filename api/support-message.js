const admin = require('firebase-admin');

const allowedOrigins = [
  'https://www.dungeoncalendar.com',
  'https://dungeoncalendar.com',
  'https://dungeoncalendarmobile.vercel.app'
];

function isAllowedOrigin(origin = '') {
  return allowedOrigins.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function initFirebaseAdmin() {
  if (admin.apps.length) return admin.firestore();
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!rawJson && !rawBase64) throw new Error('Missing Firebase service account environment variable.');
  const jsonText = rawJson || Buffer.from(rawBase64, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(jsonText);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin.firestore();
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const body = req.body || {};
  const subject = String(body.subject || 'Dungeon Calendar Support').slice(0, 200);
  const message = String(body.message || '').trim().slice(0, 8000);
  const source = String(body.source || 'contact_popup').slice(0, 120);

  if (!message) return res.status(400).json({ error: 'Missing support message.' });

  try {
    const db = initFirebaseAdmin();
    await db.collection('supportMessages').add({
      to: 'support@dungeoncalendar.com',
      subject,
      message,
      source,
      status: 'new',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Support message save failed:', error);
    return res.status(500).json({ error: 'Unable to save support request.' });
  }
};
