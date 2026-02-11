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
  loginTime: string;
  userAgent: string;
  screenSize: string;
  pages: { view: string; enteredAt: string; leftAt?: string }[];
  actions: { type: string; detail: string; timestamp: string }[];
}

const SESSION_KEY = 'novalyte-session-info';
const SLACK_WEBHOOK = import.meta.env.VITE_SLACK_WEBHOOK_URL || '';

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

/** Start a new session on login */
export async function startSession(role: 'admin' | 'guest', code: string, name: string): Promise<SessionInfo> {
  const session: SessionInfo = {
    sessionId: generateId(),
    role, code, name,
    loginTime: new Date().toISOString(),
    userAgent: navigator.userAgent,
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
    pages: [],
    actions: [],
  };
  saveSession(session);

  // Log to Supabase
  persistToSupabase(session).catch(() => {});

  // Send Slack alert
  sendSlackAlert(session).catch(() => {});

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
  saveSession(session);
  persistToSupabase(session).catch(() => {});
}

/** Track an action (button click, export, etc.) */
export function trackAction(type: string, detail: string) {
  const session = getSession();
  if (!session) return;
  session.actions.push({ type, detail, timestamp: new Date().toISOString() });
  saveSession(session);
}

/** Get current session */
export function getCurrentSession(): SessionInfo | null {
  return getSession();
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
}

/** Persist session to Supabase */
async function persistToSupabase(session: SessionInfo) {
  if (!supabase) return;
  try {
    await supabase.from('session_logs').upsert({
      session_id: session.sessionId,
      role: session.role,
      access_code: session.code,
      guest_name: session.name || null,
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

/** Send Slack webhook alert on login */
async function sendSlackAlert(session: SessionInfo) {
  if (!SLACK_WEBHOOK) {
    console.warn('No Slack webhook URL configured (VITE_SLACK_WEBHOOK_URL)');
    return;
  }

  const isGuest = session.role === 'guest';
  const emoji = isGuest ? '🚨' : '🔑';
  const roleLabel = isGuest ? 'YC Guest' : 'Admin';
  const time = new Date(session.loginTime).toLocaleString('en-US', {
    timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  const payload = {
    text: `${emoji} *Novalyte Dashboard Login*`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${emoji} ${isGuest ? 'YC Guest Login Alert' : 'Admin Login'}`, emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Who:*\n${session.name || 'Jamil (Admin)'}` },
          { type: 'mrkdwn', text: `*Role:*\n${roleLabel}` },
          { type: 'mrkdwn', text: `*Time:*\n${time}` },
          { type: 'mrkdwn', text: `*Code Used:*\n\`${session.code}\`` },
          { type: 'mrkdwn', text: `*Device:*\n${/Mobile|Android|iPhone/i.test(session.userAgent) ? '📱 Mobile' : '💻 Desktop'}` },
          { type: 'mrkdwn', text: `*Screen:*\n${session.screenSize}` },
        ],
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Session ID: \`${session.sessionId}\` · <https://intel.novalyte.io|Open Dashboard>` },
        ],
      },
    ],
  };

  try {
    await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('Slack alert failed:', err);
  }
}

/** Trigger global force-logout — kicks everyone out */
export async function forceLogoutAll(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const now = new Date().toISOString();
    await supabase.from('app_config').upsert({ key: 'force_logout_at', value: now, updated_at: now }, { onConflict: 'key' });

    // Send Slack alert about the force logout
    if (SLACK_WEBHOOK) {
      fetch(SLACK_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '🔒 *Global Logout Triggered* — All sessions have been terminated by admin.' }),
      }).catch(() => {});
    }

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

  // Flush on page unload
  const handleUnload = () => { endSession(); };
  window.addEventListener('beforeunload', handleUnload);

  return () => {
    clearInterval(flushInterval);
    clearInterval(logoutInterval);
    window.removeEventListener('beforeunload', handleUnload);
  };
}
