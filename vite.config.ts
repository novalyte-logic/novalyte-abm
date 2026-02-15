import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const SUPPRESSED_ACTIVITY_EVENT_TYPES = new Set(['blocked_backend_request'])
const LOW_SIGNAL_ACTIVITY_EVENT_TYPES = new Set(['ui_click', 'page_view'])
const LOW_SIGNAL_ACTIVITY_MIN_INTERVAL_MS = 120_000
const lowSignalSessionMap = new Map<string, number>()

function nowLabel(iso?: string) {
  const d = iso ? new Date(iso) : new Date()
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

function asSlackList(items: string[]) {
  if (!items.length) return '• No key actions captured'
  return items.map((x) => `• ${x}`).join('\n')
}

function buildPayload(kind: string, body: any) {
  const userName = String(body?.userName || 'Unknown User')
  if (kind === 'entry') {
    return {
      text: '🚨 **VIP LOGIN DETECTED**',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*User:* ${userName}\n*Time:* ${nowLabel(body?.loginTime)}\n*Status:* Online & Active` } },
      ],
    }
  }
  if (kind === 'debrief') {
    return {
      text: `📝 **Session Debrief: ${userName}**`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*Duration:* ${String(body?.duration || '0m 0s')}\n*Activity Summary:*\n${asSlackList(Array.isArray(body?.actions) ? body.actions : [])}` } },
      ],
    }
  }
  if (kind === 'live_access_request') {
    return {
      text: '🚨 **Live Access Request**',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*User:* ${userName}\n*Time:* ${nowLabel(body?.requestedAt)}\n*Request:* Live access code` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Why (optional):* ${body?.reason || 'No reason provided'}` } },
      ],
    }
  }
  if (kind === 'guest_logout_feedback') {
    return {
      text: '📝 **Guest Logout Feedback Received**',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*User:* ${userName}\n*Time:* ${nowLabel(body?.submittedAt)}\n*Feedback:*\n${String(body?.feedback || 'No feedback provided')}` } },
      ],
    }
  }
  if (kind === 'activity') {
    return {
      text: `🛰️ **2104 Activity: ${String(body?.eventType || 'event')}**`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*User:* ${userName}\n*View:* ${String(body?.view || 'unknown')}\n*Event:* ${String(body?.eventType || 'event')}\n*Detail:* ${String(body?.detail || 'n/a')}`,
          },
        },
      ],
    }
  }
  return { text: String(body?.text || 'VIP Watchtower alert') }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const slackWebhook = env.SLACK_WEBHOOK_URL || env.VITE_SLACK_WEBHOOK_URL || ''
  const resendKey = env.RESEND_API_KEY || env.VITE_RESEND_API_KEY || ''
  const watchtowerEmail = env.WATCHTOWER_EMAIL || env.VITE_WATCHTOWER_EMAIL || 'admin@novalyte.io'

  return {
    plugins: [
      react(),
      {
        name: 'watchtower-alert-route',
        configureServer(server) {
          server.middlewares.use('/api/slack-alert', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
              return
            }

            const chunks: Buffer[] = []
            req.on('data', (chunk) => chunks.push(chunk as Buffer))
            req.on('end', async () => {
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
                const kind = String(body?.kind || '')
                const eventType = String(body?.eventType || '').toLowerCase()
                const sessionId = String(body?.sessionId || 'unknown')
                if (kind === 'activity' && SUPPRESSED_ACTIVITY_EVENT_TYPES.has(eventType)) {
                  res.statusCode = 202
                  res.setHeader('content-type', 'application/json')
                  res.end(JSON.stringify({ ok: true, skipped: true, reason: 'suppressed_event_type' }))
                  return
                }
                if (kind === 'activity' && LOW_SIGNAL_ACTIVITY_EVENT_TYPES.has(eventType)) {
                  const key = sessionId
                  const now = Date.now()
                  const lastAt = lowSignalSessionMap.get(key) || 0
                  if (now - lastAt < LOW_SIGNAL_ACTIVITY_MIN_INTERVAL_MS) {
                    res.statusCode = 202
                    res.setHeader('content-type', 'application/json')
                    res.end(JSON.stringify({ ok: true, skipped: true, reason: 'low_signal_rate_limited' }))
                    return
                  }
                  lowSignalSessionMap.set(key, now)
                  for (const [mapKey, ts] of lowSignalSessionMap.entries()) {
                    if (now - ts > LOW_SIGNAL_ACTIVITY_MIN_INTERVAL_MS * 8) lowSignalSessionMap.delete(mapKey)
                  }
                }
                const payload = buildPayload(kind, body)

                if (!slackWebhook) {
                  res.statusCode = 500
                  res.setHeader('content-type', 'application/json')
                  res.end(JSON.stringify({ ok: false, error: 'Missing SLACK_WEBHOOK_URL or VITE_SLACK_WEBHOOK_URL' }))
                  return
                }

                const slackRes = await fetch(slackWebhook, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(payload),
                })
                if (!slackRes.ok) {
                  const detail = await slackRes.text()
                  res.statusCode = 502
                  res.setHeader('content-type', 'application/json')
                  res.end(JSON.stringify({ ok: false, error: `Slack failed: ${detail}` }))
                  return
                }

                if (resendKey) {
                  await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${resendKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      from: 'Novalyte Watchtower <onboarding@resend.dev>',
                      to: [watchtowerEmail],
                      subject: `[2104] ${String(kind || 'alert')} - ${String(body?.userName || 'Unknown User')}`,
                      text: JSON.stringify(body, null, 2),
                    }),
                  }).catch(() => {})
                }

                res.statusCode = 200
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify({ ok: true }))
              } catch (err: any) {
                res.statusCode = 500
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify({ ok: false, error: err?.message || 'Unknown server error' }))
              }
            })
          })
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3000,
      open: true,
    },
    test: {
      globals: true,
      environment: 'node',
    },
  }
})
