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

function getFirebaseDb() {
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
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const from = process.env.SUPPORT_FROM_EMAIL || 'Dungeon Calendar <support@dungeoncalendar.com>';
  const text = `${message}\n\nFrom account: ${fromEmail || 'Not signed in / not provided'}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: ['support@dungeoncalendar.com'],
      reply_to: fromEmail || 'support@dungeoncalendar.com',
      subject,
      text
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend support email failed: ${response.status} ${body}`);
  }
  return true;
}

async function sendWithSmtp({ subject, message, fromEmail }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return false;
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (error) {
    throw new Error('SMTP is configured but nodemailer is not installed.');
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
  await transporter.sendMail({
    from: process.env.SUPPORT_FROM_EMAIL || process.env.SMTP_USER,
    to: 'support@dungeoncalendar.com',
    replyTo: fromEmail || undefined,
    subject,
    text: `${message}\n\nFrom account: ${fromEmail || 'Not signed in / not provided'}`
  });
  return true;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const body = req.body || {};
  const subject = String(body.subject || 'Dungeon Calendar Support').slice(0, 200);
  const message = String(body.message || '').trim().slice(0, 8000);
  const source = String(body.source || 'contact_popup').slice(0, 120);
  const fromEmail = String(body.fromEmail || '').trim().slice(0, 320);
  const fromUserId = String(body.fromUserId || '').trim().slice(0, 160);

  if (!message) return res.status(400).json({ error: 'Missing support message.' });

  try {
    let delivered = false;
    delivered = await sendWithResend({ subject, message, fromEmail });
    if (!delivered) delivered = await sendWithSmtp({ subject, message, fromEmail });

    const db = getFirebaseDb();
    if (db) {
      await db.collection('supportMessages').add({
        to: 'support@dungeoncalendar.com',
        subject,
        message,
        source,
        fromEmail: fromEmail || null,
        fromUserId: fromUserId || null,
        delivery: delivered ? 'emailed' : 'stored_only',
        status: delivered ? 'sent' : 'new',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    if (!delivered && !db) {
      return res.status(500).json({
        error: 'Support email is not configured. Add RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASSWORD, or add FIREBASE_SERVICE_ACCOUNT_JSON for supportMessages storage.'
      });
    }

    return res.status(200).json({ ok: true, delivered, stored: Boolean(db) });
  } catch (error) {
    console.error('Support message failed:', error);
    return res.status(500).json({ error: error.message || 'Unable to send support request.' });
  }
};
