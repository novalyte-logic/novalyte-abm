/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyReq = any;
type AnyRes = any;
const SUPPRESSED_ACTIVITY_EVENT_TYPES = new Set(['blocked_backend_request']);
const LOW_SIGNAL_ACTIVITY_EVENT_TYPES = new Set(['ui_click', 'page_view']);
const LOW_SIGNAL_ACTIVITY_MIN_INTERVAL_MS = 120_000;
const lowSignalSessionMap = new Map<string, number>();

async function parseBody(req: AnyReq): Promise<any> {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve());
  });
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function asSlackList(items: string[]) {
  if (!items.length) return '• No key actions captured';
  return items.map((x) => `• ${x}`).join('\n');
}

function nowLabel(iso?: string) {
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

function entryPayload(userName: string, loginTime?: string) {
  return {
    text: '🚨 **VIP LOGIN DETECTED**',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*User:* ${userName}\n*Time:* ${nowLabel(loginTime)}\n*Status:* Online & Active`,
        },
      },
    ],
  };
}

function debriefPayload(userName: string, duration: string, actions: string[]) {
  return {
    text: `📝 **Session Debrief: ${userName}**`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Duration:* ${duration}\n*Activity Summary:*\n${asSlackList(actions)}`,
        },
      },
    ],
  };
}

function forceLogoutPayload(text: string) {
  return {
    text: '🔒 **VIP Watchtower Alert**',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: text || 'Global logout triggered',
        },
      },
    ],
  };
}

function liveAccessRequestPayload(userName: string, reason?: string | null, requestedAt?: string) {
  return {
    text: '🚨 **Live Access Request**',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*User:* ${userName}\n*Time:* ${nowLabel(requestedAt)}\n*Request:* Live access code`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Why (optional):* ${reason || 'No reason provided'}`,
        },
      },
    ],
  };
}

function guestLogoutFeedbackPayload(userName: string, feedback: string, submittedAt?: string) {
  return {
    text: '📝 **Guest Logout Feedback Received**',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*User:* ${userName}\n*Time:* ${nowLabel(submittedAt)}\n*Feedback:*\n${feedback || 'No feedback provided'}`,
        },
      },
    ],
  };
}

function activityPayload(userName: string, eventType: string, detail: string, view?: string, timestamp?: string) {
  return {
    text: `🛰️ **2104 Activity: ${eventType}**`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*User:* ${userName}\n*View:* ${view || 'unknown'}\n*Event:* ${eventType}\n*Time:* ${nowLabel(timestamp)}\n*Detail:*\n${detail || 'n/a'}`,
        },
      },
    ],
  };
}

async function sendEmail(subject: string, text: string) {
  const resendKey = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;
  if (!resendKey) return { ok: false, error: 'Missing RESEND_API_KEY' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Novalyte Watchtower <onboarding@resend.dev>',
      to: [process.env.WATCHTOWER_EMAIL || process.env.VITE_WATCHTOWER_EMAIL || 'admin@novalyte.io'],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    return { ok: false, error: await response.text() };
  }
  return { ok: true };
}

export default async function handler(req: AnyReq, res: AnyRes) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const webhook = process.env.SLACK_WEBHOOK_URL || process.env.VITE_SLACK_WEBHOOK_URL;
  if (!webhook) {
    return res.status(500).json({ ok: false, error: 'Missing SLACK_WEBHOOK_URL' });
  }

  try {
    const body = await parseBody(req);
    const kind = String(body?.kind || '');
    const userName = String(body?.userName || 'Unknown User');
    const eventType = String(body?.eventType || '').toLowerCase();
    const sessionId = String(body?.sessionId || 'unknown');

    if (kind === 'activity' && SUPPRESSED_ACTIVITY_EVENT_TYPES.has(eventType)) {
      return res.status(202).json({ ok: true, skipped: true, reason: 'suppressed_event_type' });
    }

    if (kind === 'activity' && LOW_SIGNAL_ACTIVITY_EVENT_TYPES.has(eventType)) {
      const key = sessionId;
      const now = Date.now();
      const lastAt = lowSignalSessionMap.get(key) || 0;
      if (now - lastAt < LOW_SIGNAL_ACTIVITY_MIN_INTERVAL_MS) {
        return res.status(202).json({ ok: true, skipped: true, reason: 'low_signal_rate_limited' });
      }
      lowSignalSessionMap.set(key, now);
      for (const [mapKey, ts] of lowSignalSessionMap.entries()) {
        if (now - ts > LOW_SIGNAL_ACTIVITY_MIN_INTERVAL_MS * 8) lowSignalSessionMap.delete(mapKey);
      }
    }

    let payload: Record<string, unknown>;
    if (kind === 'entry') {
      payload = entryPayload(userName, body?.loginTime);
    } else if (kind === 'activity') {
      payload = activityPayload(
        userName,
        String(body?.eventType || 'activity'),
        String(body?.detail || 'n/a'),
        body?.view,
        body?.timestamp
      );
    } else if (kind === 'debrief') {
      payload = debriefPayload(userName, String(body?.duration || '0m 0s'), Array.isArray(body?.actions) ? body.actions : []);
    } else if (kind === 'force_logout') {
      payload = forceLogoutPayload(String(body?.text || 'Global logout triggered'));
    } else if (kind === 'live_access_request') {
      payload = liveAccessRequestPayload(userName, body?.reason, body?.requestedAt);
    } else if (kind === 'guest_logout_feedback') {
      const feedback = String(body?.feedback || '').slice(0, 1000);
      payload = guestLogoutFeedbackPayload(userName, feedback, body?.submittedAt);
    } else {
      return res.status(400).json({ ok: false, error: 'Unknown alert kind' });
    }

    const slackRes = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!slackRes.ok) {
      const detail = await slackRes.text();
      return res.status(502).json({ ok: false, error: `Slack webhook failed: ${detail}` });
    }

    try {
      await sendEmail(
        `[2104] ${String(kind)} - ${userName}`,
        JSON.stringify(body, null, 2)
      );
    } catch {
      // Slack is primary; keep request successful even if email provider fails
    }

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message || 'Unknown server error' });
  }
}
