const functions = require('@google-cloud/functions-framework');
const nodemailer = require('nodemailer');

function cors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function safeStr(v, max = 512) {
  return String(v || '').slice(0, max);
}

functions.http('smtpSendHandler', async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const {
      to,
      subject,
      html,
      text,
      contactId,
      clinicName,
      market,
      tags,
    } = req.body || {};

    if (!isValidEmail(to)) return res.status(400).json({ ok: false, error: 'Invalid to email' });
    if (!subject || !String(subject).trim()) return res.status(400).json({ ok: false, error: 'Subject required' });
    if (!html || !String(html).trim()) return res.status(400).json({ ok: false, error: 'HTML required' });

    const SMTP_HOST = process.env.SMTP_HOST || '';
    const SMTP_PORT = Number(process.env.SMTP_PORT || '587');
    const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
    const SMTP_USER = process.env.SMTP_USER || '';
    const SMTP_PASS = process.env.SMTP_PASS || '';
    const FROM = process.env.SMTP_FROM || process.env.FROM || '';

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !FROM) {
      return res.status(500).json({ ok: false, error: 'SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM)' });
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });

    const hdrs = {
      'X-Novalyte-Contact-Id': safeStr(contactId, 128),
      'X-Novalyte-Clinic': safeStr(clinicName, 256),
      'X-Novalyte-Market': safeStr(market, 256),
    };

    // Map tags to headers (lightweight, optional)
    if (Array.isArray(tags)) {
      for (const t of tags.slice(0, 10)) {
        if (!t?.name || !t?.value) continue;
        const key = `X-Novalyte-Tag-${safeStr(t.name, 32)}`.replace(/[^A-Za-z0-9_-]/g, '_');
        hdrs[key] = safeStr(t.value, 128);
      }
    }

    const info = await transporter.sendMail({
      from: FROM,
      to,
      subject: safeStr(subject, 512),
      html: String(html),
      text: text ? String(text) : undefined,
      headers: hdrs,
    });

    // Nodemailer doesn't guarantee a stable id; expose messageId.
    return res.json({
      ok: true,
      id: info.messageId || `smtp-${Date.now()}`,
      from: FROM,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
