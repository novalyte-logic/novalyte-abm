/**
 * Session Tracker — Logs logins, page views, actions, and sends Slack alerts
 * Stores session data in Supabase `session_logs` table
 */
import { supabase } from '../lib/supabase';

export interface SessionInfo {
  sessionId: string;
  role: 'admin' | 'guest';
  code: string;
  name: string;
  company?: string;
  loginTime: string;
  userAgent: string;
  screenSize: string;
  pages: { view: string; enteredAt: string; leftAt?: string }[];
  actions: { type: string; detail: string; timestamp: string }[];
}

const SESSION_KEY = 'novalyte-session-info';
const SESSION_LOG_KEY = 'novalyte-session-log';
const DEBRIEF_SENT_KEY = 'novalyte-session-debrief-sent';
const SLACK_ALERT_ENDPOINT = '/api/slack-alert';
const FALLBACK_SLACK_WEBHOOK = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SLACK_WEBHOOK_URL) || '';
const FALLBACK_RESEND_KEY = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_RESEND_API_KEY) || '';
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_LOG_ENTRIES = 15;

function generateId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getSession(): SessionInfo | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSession(session: SessionInfo) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
}

interface SessionLogEntry {
  message: string;
  kind: 'page' | 'action';
  timestamp: string;
}

function readSessionLog(): SessionLogEntry[] {
  try {
    const raw = localStorage.getItem(SESSION_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSessionLog(entries: SessionLogEntry[]) {
  try { localStorage.setItem(SESSION_LOG_KEY, JSON.stringify(entries)); } catch {}
}

function clearSessionLog() {
  try { localStorage.removeItem(SESSION_LOG_KEY); } catch {}
}

function appendSessionLog(kind: SessionLogEntry['kind'], message: string) {
  const next: SessionLogEntry[] = [...readSessionLog(), { kind, message, timestamp: new Date().toISOString() }]
    .slice(-MAX_LOG_ENTRIES);
  saveSessionLog(next);
}

function clearDebriefSent() {
  try { sessionStorage.removeItem(DEBRIEF_SENT_KEY); } catch {}
}

function isDebriefSent(sessionId: string) {
  try { return sessionStorage.getItem(DEBRIEF_SENT_KEY) === sessionId; } catch { return false; }
}

function markDebriefSent(sessionId: string) {
  try { sessionStorage.setItem(DEBRIEF_SENT_KEY, sessionId); } catch {}
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function summarizeRecentActivity(limit = 10): string[] {
  return readSessionLog().slice(-limit).map(e => e.message);
}

type SlackAlertKind = 'entry' | 'debrief' | 'force_logout' | 'live_access_request' | 'guest_logout_feedback';

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

function asSlackList(items: string[]) {
  if (!items.length) return '• No key actions captured';
  return items.map((x) => `• ${x}`).join('\n');
}

function buildSlackPayload(kind: SlackAlertKind, payload: Record<string, any>) {
  const userName = String(payload?.userName || 'Unknown User');
  if (kind === 'entry') {
    return {
      text: '🚨 **VIP LOGIN DETECTED**',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*User:* ${userName}\n*Time:* ${nowLabel(payload?.loginTime)}\n*Status:* Online & Active` } },
      ],
    };
  }
  if (kind === 'debrief') {
    return {
      text: `📝 **Session Debrief: ${userName}**`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*Duration:* ${String(payload?.duration || '0m 0s')}\n*Activity Summary:*\n${asSlackList(Array.isArray(payload?.actions) ? payload.actions : [])}` } },
      ],
    };
  }
  if (kind === 'live_access_request') {
    return {
      text: '🚨 **Live Access Request**',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*User:* ${userName}\n*Time:* ${nowLabel(payload?.requestedAt)}\n*Request:* Live access code` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Why (optional):* ${payload?.reason || 'No reason provided'}` } },
      ],
    };
  }
  if (kind === 'guest_logout_feedback') {
    return {
      text: '📝 **Guest Logout Feedback Received**',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*User:* ${userName}\n*Time:* ${nowLabel(payload?.submittedAt)}\n*Feedback:*\n${String(payload?.feedback || 'No feedback provided')}` } },
      ],
    };
  }
  return {
    text: String(payload?.text || 'VIP Watchtower alert'),
  };
}

async function sendSlackAlert(kind: SlackAlertKind, payload: Record<string, any>, useBeacon = false): Promise<{ apiOk: boolean; fallbackOk: boolean }> {
  const body = JSON.stringify({ kind, ...payload });

  if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon(SLACK_ALERT_ENDPOINT, new Blob([body], { type: 'application/json' }));
    return { apiOk: true, fallbackOk: false };
  }

  let apiOk = false;
  try {
    const response = await fetch(SLACK_ALERT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
    apiOk = response.ok;
  } catch {
    apiOk = false;
  }

  if (apiOk) return { apiOk: true, fallbackOk: false };
  if (!FALLBACK_SLACK_WEBHOOK) return { apiOk: false, fallbackOk: false };

  try {
    const slackPayload = buildSlackPayload(kind, payload);
    const res = await fetch(FALLBACK_SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload),
      keepalive: true,
    });
    if (kind === 'entry' && FALLBACK_RESEND_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FALLBACK_RESEND_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Novalyte Watchtower <onboarding@resend.dev>',
            to: ['kaizen@novalyte.io'],
            subject: `VIP LOGIN DETECTED: ${String(payload?.userName || 'Unknown User')}`,
            text: `User: ${String(payload?.userName || 'Unknown User')}\nTime: ${nowLabel(payload?.loginTime)}\nStatus: Online & Active`,
          }),
          keepalive: true,
        });
      } catch {}
    }
    return { apiOk: false, fallbackOk: res.ok };
  } catch {
    return { apiOk: false, fallbackOk: false };
  }
}

/** Start a new session on login */
export async function startSession(role: 'admin' | 'guest', code: string, name: string, company?: string): Promise<SessionInfo> {
  const session: SessionInfo = {
    sessionId: generateId(),
    role, code, name, company: company?.trim() || undefined,
    loginTime: new Date().toISOString(),
    userAgent: navigator.userAgent,
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
    pages: [],
    actions: [],
  };
  saveSession(session);
  clearSessionLog();
  clearDebriefSent();
  appendSessionLog('action', `Logged in as ${name || (role === 'admin' ? 'Admin' : 'Guest')}`);

  // Log to Supabase
  persistToSupabase(session).catch(() => {});

  // Send VIP entry alert
  sendSlackAlert('entry', {
    userName: [name || (role === 'admin' ? 'Jamil' : 'Guest'), company?.trim()].filter(Boolean).join(' • '),
    role,
    sessionId: session.sessionId,
    loginTime: session.loginTime,
    status: 'Online & Active',
  }).catch(() => {});

  return session;
}

/** Track a page view */
export function trackPageView(view: string) {
  const session = getSession();
  if (!session) return;

  // Close previous page
  if (session.pages.length > 0) {
    const last = session.pages[session.pages.length - 1];
    if (!last.leftAt) last.leftAt = new Date().toISOString();
  }

  session.pages.push({ view, enteredAt: new Date().toISOString() });
  appendSessionLog('page', `Viewed ${view}`);
  session.actions.push({ type: 'page_view', detail: `Viewed ${view}`, timestamp: new Date().toISOString() });
  saveSession(session);
  persistToSupabase(session).catch(() => {});
}

/** Track an action (button click, export, etc.) */
export function trackAction(type: string, detail: string) {
  const session = getSession();
  if (!session) return;
  session.actions.push({ type, detail, timestamp: new Date().toISOString() });
  appendSessionLog('action', detail);
  saveSession(session);
}

/** Get current session */
export function getCurrentSession(): SessionInfo | null {
  return getSession();
}

export async function requestLiveAccessCode(reason?: string): Promise<void> {
  const session = getSession();
  if (!session) return;

  await sendSlackAlert('live_access_request', {
    userName: [session.name || 'Guest', session.company].filter(Boolean).join(' • '),
    role: session.role,
    sessionId: session.sessionId,
    reason: (reason || '').trim() || null,
    requestedAt: new Date().toISOString(),
  });
}

export async function submitGuestLogoutFeedback(feedback: string): Promise<void> {
  const session = getSession();
  if (!session) return;

  const payload = {
    userName: [session.name || 'Guest', session.company].filter(Boolean).join(' • '),
    role: session.role,
    sessionId: session.sessionId,
    feedback: feedback.trim().slice(0, 1000),
    submittedAt: new Date().toISOString(),
  };

  const result = await sendSlackAlert('guest_logout_feedback', payload);
  if (result.apiOk || !FALLBACK_RESEND_KEY) return;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FALLBACK_RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Novalyte Watchtower <onboarding@resend.dev>',
        to: ['kaizen@novalyte.io'],
        subject: `Guest Logout Feedback: ${payload.userName}`,
        text: `User: ${payload.userName}\nTime: ${nowLabel(payload.submittedAt)}\n\nFeedback:\n${payload.feedback}`,
      }),
      keepalive: true,
    });
  } catch {}
}

/** Get session duration in minutes */
export function getSessionDuration(): number {
  const session = getSession();
  if (!session) return 0;
  return Math.round((Date.now() - new Date(session.loginTime).getTime()) / 60000);
}

/** End session — flush final data */
export async function endSession() {
  const session = getSession();
  if (!session) return;
  // Close last page
  if (session.pages.length > 0) {
    const last = session.pages[session.pages.length - 1];
    if (!last.leftAt) last.leftAt = new Date().toISOString();
  }
  await persistToSupabase(session);
  await sendSessionDebrief('Session ended');
}

/** Persist session to Supabase */
async function persistToSupabase(session: SessionInfo) {
  if (!supabase) return;
  try {
    await supabase.from('session_logs').upsert({
      session_id: session.sessionId,
      role: session.role,
      access_code: session.code,
      guest_name: session.company ? `${session.name} (${session.company})` : (session.name || null),
      login_time: session.loginTime,
      user_agent: session.userAgent,
      screen_size: session.screenSize,
      pages_visited: session.pages,
      actions_taken: session.actions,
      duration_minutes: getSessionDuration(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'session_id' });
  } catch (err) {
    console.warn('Session persist failed:', err);
  }
}

async function sendSessionDebrief(reason: 'Session ended' | 'Idle timeout' | 'Tab closed', useBeacon = false) {
  const session = getSession();
  if (!session || isDebriefSent(session.sessionId)) return;

  const durationSeconds = Math.max(0, Math.floor((Date.now() - new Date(session.loginTime).getTime()) / 1000));
  const activitySummary = summarizeRecentActivity(12);
  markDebriefSent(session.sessionId);

  await sendSlackAlert('debrief', {
    userName: [session.name || (session.role === 'admin' ? 'Jamil' : 'Guest'), session.company].filter(Boolean).join(' • '),
    sessionId: session.sessionId,
    duration: formatDuration(durationSeconds),
    reason,
    actions: activitySummary,
  }, useBeacon);
}

/** Trigger global force-logout — kicks everyone out */
export async function forceLogoutAll(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const now = new Date().toISOString();
    await supabase.from('app_config').upsert({ key: 'force_logout_at', value: now, updated_at: now }, { onConflict: 'key' });

    // Send Slack alert about the force logout
    sendSlackAlert('force_logout', { text: '🔒 Global Logout Triggered — All sessions have been terminated by admin.' }).catch(() => {});

    return true;
  } catch (err) {
    console.warn('Force logout failed:', err);
    return false;
  }
}

/** Check if current session has been force-logged-out */
export async function checkForceLogout(): Promise<boolean> {
  if (!supabase) return false;
  const session = getSession();
  if (!session) return false;
  try {
    const { data } = await supabase.from('app_config').select('value').eq('key', 'force_logout_at').single();
    if (!data?.value) return false;
    const forceTime = new Date(data.value).getTime();
    const loginTime = new Date(session.loginTime).getTime();
    return forceTime > loginTime;
  } catch { return false; }
}

/** Flush session data periodically + poll for force-logout (call on beforeunload) */
export function setupSessionFlush(onForceLogout: () => void) {
  // Flush every 30 seconds
  const flushInterval = setInterval(() => {
    const session = getSession();
    if (session) persistToSupabase(session).catch(() => {});
  }, 30000);

  // Poll for force-logout every 10 seconds
  const logoutInterval = setInterval(async () => {
    const kicked = await checkForceLogout();
    if (kicked) {
      clearInterval(flushInterval);
      clearInterval(logoutInterval);
      onForceLogout();
    }
  }, 10000);

  let idleTimer: number | undefined;
  const resetIdleTimer = () => {
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      sendSessionDebrief('Idle timeout').catch(() => {});
    }, IDLE_TIMEOUT_MS);
  };

  // Flush on page unload
  const handleUnload = () => {
    sendSessionDebrief('Tab closed', true).catch(() => {});
  };
  window.addEventListener('beforeunload', handleUnload);
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((eventName) => {
    window.addEventListener(eventName, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();

  return () => {
    clearInterval(flushInterval);
    clearInterval(logoutInterval);
    if (idleTimer) window.clearTimeout(idleTimer);
    window.removeEventListener('beforeunload', handleUnload);
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((eventName) => {
      window.removeEventListener(eventName, resetIdleTimer);
    });
  };
}
