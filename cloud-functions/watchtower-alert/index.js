const functions = require('@google-cloud/functions-framework');

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ALERT_TO_EMAIL = process.env.ALERT_TO_EMAIL || 'admin@novalyte.io';
const ALERT_FROM_EMAIL = process.env.ALERT_FROM_EMAIL || 'Novalyte Watchtower <onboarding@resend.dev>';
const TARGET_USER_CODE = process.env.TARGET_USER_CODE || '2104';
const SUPPRESSED_ACTIVITY_EVENT_TYPES = new Set(['blocked_backend_request']);
const LOW_SIGNAL_ACTIVITY_EVENT_TYPES = new Set(['ui_click', 'page_view']);
const LOW_SIGNAL_ACTIVITY_MIN_INTERVAL_MS = 120000;
const lowSignalSessionMap = new Map();

function nowLabel(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function escapeHtml(input) {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(input, max = 1200) {
  const v = String(input ?? '');
  return v.length > max ? `${v.slice(0, max)}...` : v;
}

function shouldAlert(body) {
  const code = body?.code ? String(body.code) : '';
  if (!code) return true;
  return code === TARGET_USER_CODE;
}

function shouldSuppressAlert(kind, body) {
  if (kind !== 'activity') return false;
  const eventType = String(body?.eventType || '').toLowerCase();
  return SUPPRESSED_ACTIVITY_EVENT_TYPES.has(eventType);
}

function shouldRateLimitLowSignal(kind, body) {
  if (kind !== 'activity') return false;
  const eventType = String(body?.eventType || '').toLowerCase();
  if (!LOW_SIGNAL_ACTIVITY_EVENT_TYPES.has(eventType)) return false;

  const sessionId = String(body?.sessionId || 'unknown');
  const key = sessionId;
  const now = Date.now();
  const lastAt = lowSignalSessionMap.get(key) || 0;
  if (now - lastAt < LOW_SIGNAL_ACTIVITY_MIN_INTERVAL_MS) return true;

  lowSignalSessionMap.set(key, now);
  for (const [mapKey, ts] of lowSignalSessionMap.entries()) {
    if (now - ts > LOW_SIGNAL_ACTIVITY_MIN_INTERVAL_MS * 8) lowSignalSessionMap.delete(mapKey);
  }
  return false;
}

function buildSlackPayload(kind, body) {
  const userName = String(body?.userName || 'Unknown');
  const eventType = String(body?.eventType || kind || 'unknown');
  const detail = truncate(String(body?.detail || body?.text || 'No detail'));
  const view = String(body?.view || 'unknown');
  const sessionId = String(body?.sessionId || 'n/a');
  const timestamp = String(body?.timestamp || body?.loginTime || body?.submittedAt || body?.requestedAt || new Date().toISOString());
  const recent = Array.isArray(body?.recentActions) ? body.recentActions.slice(-12) : [];

  return {
    text: `[2104] ${eventType} — ${userName}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `2104 Watchtower: ${eventType}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*User:*\n${userName}` },
          { type: 'mrkdwn', text: `*Code:*\n${String(body?.code || TARGET_USER_CODE)}` },
          { type: 'mrkdwn', text: `*Role:*\n${String(body?.role || 'guest')}` },
          { type: 'mrkdwn', text: `*View:*\n${view}` },
          { type: 'mrkdwn', text: `*Session:*\n\`${sessionId}\`` },
          { type: 'mrkdwn', text: `*Time:*\n${nowLabel(timestamp)}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Detail:*\n${detail}`,
        },
      },
      ...(recent.length
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Recent Activity:*\n${recent.map((x) => `• ${truncate(x, 220)}`).join('\n')}`,
              },
            },
          ]
        : []),
    ],
  };
}

function buildEmail(kind, body) {
  const userName = escapeHtml(body?.userName || 'Unknown');
  const eventType = escapeHtml(body?.eventType || kind || 'unknown');
  const detail = escapeHtml(truncate(body?.detail || body?.text || 'No detail', 4000));
  const view = escapeHtml(body?.view || 'unknown');
  const sessionId = escapeHtml(body?.sessionId || 'n/a');
  const code = escapeHtml(body?.code || TARGET_USER_CODE);
  const role = escapeHtml(body?.role || 'guest');
  const timestamp = escapeHtml(body?.timestamp || body?.loginTime || body?.submittedAt || body?.requestedAt || new Date().toISOString());
  const payload = escapeHtml(JSON.stringify(body, null, 2));

  const subject = `[2104] ${eventType} — ${body?.userName || 'Unknown'}`;
  const html = `
<!doctype html>
<html>
  <body style="font-family:Arial,sans-serif;background:#0b1220;color:#e5e7eb;padding:20px;">
    <h2 style="margin-top:0;color:#22d3ee;">2104 Watchtower Alert</h2>
    <table style="width:100%;border-collapse:collapse;background:#111827;border:1px solid #334155;">
      <tr><td style="padding:10px;border:1px solid #334155;"><b>User</b></td><td style="padding:10px;border:1px solid #334155;">${userName}</td></tr>
      <tr><td style="padding:10px;border:1px solid #334155;"><b>Code</b></td><td style="padding:10px;border:1px solid #334155;">${code}</td></tr>
      <tr><td style="padding:10px;border:1px solid #334155;"><b>Role</b></td><td style="padding:10px;border:1px solid #334155;">${role}</td></tr>
      <tr><td style="padding:10px;border:1px solid #334155;"><b>Event</b></td><td style="padding:10px;border:1px solid #334155;">${eventType}</td></tr>
      <tr><td style="padding:10px;border:1px solid #334155;"><b>View</b></td><td style="padding:10px;border:1px solid #334155;">${view}</td></tr>
      <tr><td style="padding:10px;border:1px solid #334155;"><b>Session</b></td><td style="padding:10px;border:1px solid #334155;">${sessionId}</td></tr>
      <tr><td style="padding:10px;border:1px solid #334155;"><b>Time</b></td><td style="padding:10px;border:1px solid #334155;">${nowLabel(timestamp)}</td></tr>
      <tr><td style="padding:10px;border:1px solid #334155;"><b>Detail</b></td><td style="padding:10px;border:1px solid #334155;">${detail}</td></tr>
    </table>
    <h3 style="color:#93c5fd;margin-top:20px;">Raw Payload</h3>
    <pre style="white-space:pre-wrap;background:#020617;border:1px solid #334155;padding:12px;border-radius:6px;">${payload}</pre>
  </body>
</html>`;

  return { subject, html };
}

async function sendSlack(payload) {
  if (!SLACK_WEBHOOK_URL) throw new Error('SLACK_WEBHOOK_URL not configured');
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Slack error ${res.status}: ${await res.text()}`);
}

async function sendEmail(subject, html) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: ALERT_FROM_EMAIL,
      to: [ALERT_TO_EMAIL],
      subject,
      html,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${JSON.stringify(json)}`);
  return json?.id;
}

functions.http('watchtowerAlert', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const kind = String(body.kind || 'activity');

  if (!shouldAlert(body)) {
    res.status(202).json({ ok: true, skipped: true, reason: 'code does not match target user' });
    return;
  }

  if (shouldSuppressAlert(kind, body)) {
    res.status(202).json({ ok: true, skipped: true, reason: 'suppressed_event_type' });
    return;
  }

  if (shouldRateLimitLowSignal(kind, body)) {
    res.status(202).json({ ok: true, skipped: true, reason: 'low_signal_rate_limited' });
    return;
  }

  try {
    const slackPayload = buildSlackPayload(kind, body);
    const { subject, html } = buildEmail(kind, body);

    const [_, emailId] = await Promise.all([
      sendSlack(slackPayload),
      sendEmail(subject, html),
    ]);

    console.log('Watchtower alert sent', {
      kind,
      code: body?.code,
      user: body?.userName,
      eventType: body?.eventType,
      sessionId: body?.sessionId,
      emailId,
    });

    res.status(200).json({ ok: true, emailId });
  } catch (error) {
    console.error('Watchtower alert failed', {
      error: error?.message || String(error),
      kind,
      code: body?.code,
      user: body?.userName,
      eventType: body?.eventType,
      sessionId: body?.sessionId,
    });
    res.status(500).json({ ok: false, error: error?.message || 'Unknown error' });
  }
});
