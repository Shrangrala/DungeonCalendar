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
  if (!rawJson && !rawBase64) return null;
  const jsonText = rawJson || Buffer.from(rawBase64, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(jsonText);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin.firestore();
}

async function sendWithResend({ subject, message, fromEmail }) {
  if (!process.env.RESEND_API_KEY) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.SUPPORT_FROM_EMAIL || 'Dungeon Calendar <support@dungeoncalendar.com>',
      to: process.env.SUPPORT_TO_EMAIL || 'support@dungeoncalendar.com',
      reply_to: fromEmail || undefined,
      subject,
      text: message
    })
  });
  if (!response.ok) throw new Error(`Resend failed: ${response.status}`);
  return true;
}

async function forwardToWebhook(payload) {
  if (!process.env.SUPPORT_WEBHOOK_URL) return false;
  const response = await fetch(process.env.SUPPORT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Support webhook failed: ${response.status}`);
  return true;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const body = req.body || {};
  const subject = String(body.subject || 'Dungeon Calendar Support').slice(0, 200);
  const message = String(body.message || '').trim().slice(0, 8000);
  const fromEmail = String(body.fromEmail || '').trim().slice(0, 320);
  const fromUserId = String(body.fromUserId || '').trim().slice(0, 200);
  const source = String(body.source || 'contact_popup').slice(0, 120);

  if (!message) return res.status(400).json({ error: 'Missing support message.' });

  const supportRecord = {
    to: process.env.SUPPORT_TO_EMAIL || 'support@dungeoncalendar.com',
    subject,
    message,
    fromEmail: fromEmail || null,
    fromUserId: fromUserId || null,
    source,
    status: 'new'
  };

  try {
    if (await sendWithResend({ subject, message, fromEmail })) {
      return res.status(200).json({ ok: true, deliveredBy: 'resend' });
    }

    if (await forwardToWebhook(supportRecord)) {
      return res.status(200).json({ ok: true, deliveredBy: 'webhook' });
    }

    const db = initFirebaseAdmin();
    if (db) {
      await db.collection('supportMessages').add({
        ...supportRecord,
        status: 'new',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.status(200).json({ ok: true, deliveredBy: 'firebase_admin' });
    }

    return res.status(500).json({
      error: 'Support sending is not configured. Add RESEND_API_KEY, SUPPORT_WEBHOOK_URL, or FIREBASE_SERVICE_ACCOUNT_JSON.'
    });
  } catch (error) {
    console.error('Support message failed:', error);
    return res.status(500).json({ error: 'Unable to send support request.' });
  }
};
