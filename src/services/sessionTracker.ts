/**
 * Session Tracker — logs login/page/actions and sends watchtower alerts.
 * 2104 guest sessions are fully audited to Slack + email.
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
const ALERT_DEBUG_KEY = 'novalyte-alert-debug';
const WATCH_USER_CODE = '2104';
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_LOG_ENTRIES = 20;
const ACTIVITY_ALERT_MIN_INTERVAL_MS = 4_000;
const ACTIVITY_ALERT_DEDUPE_WINDOW_MS = 45_000;
const SILENCED_ACTIVITY_TYPES = new Set<string>(['blocked_backend_request']);
const LOW_SIGNAL_ACTIVITY_TYPES = new Set<string>(['ui_click', 'page_view']);
const LOW_SIGNAL_ACTIVITY_MIN_INTERVAL_MS = 120_000;
let sessionLogsWriteBlocked = false;
let sessionLogsBackoffUntil = 0;
let sessionLogsLastNoticeAt = 0;
const SESSION_LOG_BACKOFF_MS = 60_000;
const SESSION_LOG_NOTICE_INTERVAL_MS = 120_000;

const WATCHTOWER_ALERT_ENDPOINT =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_WATCHTOWER_ALERT_URL) ||
  'https://us-central1-warp-486714.cloudfunctions.net/watchtowerAlert';

const WATCHTOWER_EMAIL =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_WATCHTOWER_EMAIL) ||
  'admin@novalyte.io';

let lastActivityAlertAt = 0;
const recentActivityAlertMap = new Map<string, number>();
const lastLowSignalAlertBySession = new Map<string, number>();

function generateId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function shouldAttemptSessionLogsWrite(): boolean {
  if (!supabase || sessionLogsWriteBlocked) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (Date.now() < sessionLogsBackoffUntil) return false;
  return true;
}

function noticeSessionLogs(message: string, level: 'info' | 'warn' = 'info') {
  const now = Date.now();
  if (now - sessionLogsLastNoticeAt < SESSION_LOG_NOTICE_INTERVAL_MS) return;
  sessionLogsLastNoticeAt = now;
  if (level === 'warn') console.warn(message);
  else console.info(message);
}

function getSession(): SessionInfo | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session: SessionInfo) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {}
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
  try {
    localStorage.setItem(SESSION_LOG_KEY, JSON.stringify(entries));
  } catch {}
}

function clearSessionLog() {
  try {
    localStorage.removeItem(SESSION_LOG_KEY);
  } catch {}
}

function appendSessionLog(kind: SessionLogEntry['kind'], message: string) {
  const next: SessionLogEntry[] = [...readSessionLog(), { kind, message, timestamp: nowIso() }].slice(
    -MAX_LOG_ENTRIES
  );
  saveSessionLog(next);
}

function clearDebriefSent() {
  try {
    sessionStorage.removeItem(DEBRIEF_SENT_KEY);
  } catch {}
}

function isDebriefSent(sessionId: string) {
  try {
    return sessionStorage.getItem(DEBRIEF_SENT_KEY) === sessionId;
  } catch {
    return false;
  }
}

function markDebriefSent(sessionId: string) {
  try {
    sessionStorage.setItem(DEBRIEF_SENT_KEY, sessionId);
  } catch {}
}

function appendAlertDebug(event: string, detail: string) {
  try {
    const existing = JSON.parse(localStorage.getItem(ALERT_DEBUG_KEY) || '[]');
    const next = Array.isArray(existing) ? existing : [];
    next.push({ event, detail, at: nowIso() });
    localStorage.setItem(ALERT_DEBUG_KEY, JSON.stringify(next.slice(-100)));
  } catch {}
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function summarizeRecentActivity(limit = 15): string[] {
  return readSessionLog().slice(-limit).map((e) => e.message);
}

function safeTrim(input: string, max = 240): string {
  const v = String(input || '').trim();
  if (!v) return 'n/a';
  return v.length > max ? `${v.slice(0, max)}...` : v;
}

function getUserLabel(session: SessionInfo): string {
  return [session.name || (session.role === 'admin' ? 'Jamil' : 'Guest'), session.company]
    .filter(Boolean)
    .join(' • ');
}

function getCurrentView(session: SessionInfo): string {
  if (!session.pages.length) return 'unknown';
  return session.pages[session.pages.length - 1].view;
}

function isWatchedSession(session: SessionInfo | null | undefined): session is SessionInfo {
  return Boolean(session && session.role === 'guest' && session.code === WATCH_USER_CODE);
}

type AlertKind =
  | 'entry'
  | 'activity'
  | 'debrief'
  | 'force_logout'
  | 'live_access_request'
  | 'guest_logout_feedback';

async function sendWatchtowerAlert(kind: AlertKind, payload: Record<string, any>, useBeacon = false): Promise<boolean> {
  const body = JSON.stringify({
    kind,
    targetUserCode: WATCH_USER_CODE,
    alertToEmail: WATCHTOWER_EMAIL,
    ...payload,
  });

  if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const ok = navigator.sendBeacon(WATCHTOWER_ALERT_ENDPOINT, new Blob([body], { type: 'application/json' }));
    appendAlertDebug('beacon_delivery', `${kind}: ${ok ? 'ok' : 'fail'}`);
    return ok;
  }

  try {
    const response = await fetch(WATCHTOWER_ALERT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });

    const contentType = response.headers.get('content-type') || '';
    const parsed = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null;

    const ok = response.ok && (parsed?.ok ?? true);
    appendAlertDebug('alert_delivery', `${kind}: ${ok ? 'ok' : `fail ${response.status}`}`);
    return ok;
  } catch (error: any) {
    appendAlertDebug('alert_delivery', `${kind}: exception ${error?.message || 'unknown'}`);
    return false;
  }
}

function notifyWatchedActivity(
  session: SessionInfo,
  eventType: string,
  detail: string,
  extra: Record<string, any> = {}
) {
  if (!isWatchedSession(session)) return;
  const normalizedEventType = String(eventType || '').toLowerCase();
  if (SILENCED_ACTIVITY_TYPES.has(normalizedEventType)) return;

  const now = Date.now();
  if (LOW_SIGNAL_ACTIVITY_TYPES.has(normalizedEventType)) {
    const lastLowSignalAlertAt = lastLowSignalAlertBySession.get(session.sessionId) || 0;
    if (now - lastLowSignalAlertAt < LOW_SIGNAL_ACTIVITY_MIN_INTERVAL_MS) return;
    lastLowSignalAlertBySession.set(session.sessionId, now);

    for (const [key, ts] of lastLowSignalAlertBySession.entries()) {
      if (now - ts > LOW_SIGNAL_ACTIVITY_MIN_INTERVAL_MS * 6) lastLowSignalAlertBySession.delete(key);
    }
  }

  const view = String(extra.view || getCurrentView(session));
  const signature = `${eventType}::${detail.slice(0, 180)}::${view}`;
  const lastForSignature = recentActivityAlertMap.get(signature) || 0;

  // Hard guardrails to prevent alert storms.
  if (now - lastActivityAlertAt < ACTIVITY_ALERT_MIN_INTERVAL_MS) return;
  if (now - lastForSignature < ACTIVITY_ALERT_DEDUPE_WINDOW_MS) return;

  // Cleanup old signatures.
  for (const [key, ts] of recentActivityAlertMap.entries()) {
    if (now - ts > ACTIVITY_ALERT_DEDUPE_WINDOW_MS) recentActivityAlertMap.delete(key);
  }

  recentActivityAlertMap.set(signature, now);
  lastActivityAlertAt = now;

  const actions = summarizeRecentActivity(15);
  void sendWatchtowerAlert('activity', {
    userName: getUserLabel(session),
    role: session.role,
    code: session.code,
    sessionId: session.sessionId,
    eventType,
    detail: safeTrim(detail, 500),
    view,
    timestamp: nowIso(),
    recentActions: actions,
    ...extra,
  });
}

/** Start a new session on login */
export async function startSession(role: 'admin' | 'guest', code: string, name: string, company?: string): Promise<SessionInfo> {
  const session: SessionInfo = {
    sessionId: generateId(),
    role,
    code,
    name,
    company: company?.trim() || undefined,
    loginTime: nowIso(),
    userAgent: navigator.userAgent,
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
    pages: [],
    actions: [],
  };

  saveSession(session);
  clearSessionLog();
  clearDebriefSent();

  const loginDetail = `Logged in as ${getUserLabel(session)}`;
  appendSessionLog('action', loginDetail);
  session.actions.push({ type: 'login', detail: loginDetail, timestamp: nowIso() });
  saveSession(session);

  persistToSupabase(session).catch(() => {});

  if (isWatchedSession(session)) {
    void sendWatchtowerAlert('entry', {
      userName: getUserLabel(session),
      role,
      code,
      sessionId: session.sessionId,
      loginTime: session.loginTime,
      userAgent: session.userAgent,
      screenSize: session.screenSize,
      status: 'Online & Active',
      detail: '2104 guest login',
    });
  }

  return session;
}

/** Track a page view */
export function trackPageView(view: string) {
  const session = getSession();
  if (!session) return;

  if (session.pages.length > 0) {
    const last = session.pages[session.pages.length - 1];
    if (!last.leftAt) last.leftAt = nowIso();
  }

  session.pages.push({ view, enteredAt: nowIso() });

  const detail = `Viewed ${view}`;
  appendSessionLog('page', detail);
  session.actions.push({ type: 'page_view', detail, timestamp: nowIso() });
  saveSession(session);

  persistToSupabase(session).catch(() => {});
  notifyWatchedActivity(session, 'page_view', detail, { view });
}

/** Track an action */
export function trackAction(type: string, detail: string) {
  const session = getSession();
  if (!session) return;

  const normalizedDetail = safeTrim(detail, 500);
  session.actions.push({ type, detail: normalizedDetail, timestamp: nowIso() });
  appendSessionLog('action', `${type}: ${normalizedDetail}`);
  saveSession(session);

  notifyWatchedActivity(session, type, normalizedDetail);
}

/** Get current session */
export function getCurrentSession(): SessionInfo | null {
  return getSession();
}

export async function requestLiveAccessCode(reason?: string): Promise<void> {
  const session = getSession();
  if (!session) return;

  if (isWatchedSession(session)) {
    await sendWatchtowerAlert('live_access_request', {
      userName: getUserLabel(session),
      role: session.role,
      code: session.code,
      sessionId: session.sessionId,
      reason: safeTrim((reason || '').trim() || 'No reason provided', 800),
      requestedAt: nowIso(),
      view: getCurrentView(session),
      recentActions: summarizeRecentActivity(15),
    });
  }
}

export async function submitGuestLogoutFeedback(feedback: string): Promise<void> {
  const session = getSession();
  if (!session) return;

  if (isWatchedSession(session)) {
    await sendWatchtowerAlert('guest_logout_feedback', {
      userName: getUserLabel(session),
      role: session.role,
      code: session.code,
      sessionId: session.sessionId,
      feedback: safeTrim(feedback.trim().slice(0, 1000), 1000),
      submittedAt: nowIso(),
      view: getCurrentView(session),
      recentActions: summarizeRecentActivity(20),
    });
  }
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

  if (session.pages.length > 0) {
    const last = session.pages[session.pages.length - 1];
    if (!last.leftAt) last.leftAt = nowIso();
  }

  await persistToSupabase(session);
  await sendSessionDebrief('Session ended');
}

/** Persist session to Supabase */
async function persistToSupabase(session: SessionInfo) {
  if (!shouldAttemptSessionLogsWrite()) return;

  try {
    const { error, status } = await supabase.from('session_logs').upsert(
      {
        session_id: session.sessionId,
        role: session.role,
        access_code: session.code,
        guest_name: session.company ? `${session.name} (${session.company})` : session.name || null,
        login_time: session.loginTime,
        user_agent: session.userAgent,
        screen_size: session.screenSize,
        pages_visited: session.pages,
        actions_taken: session.actions,
        duration_minutes: getSessionDuration(),
        updated_at: nowIso(),
      },
      { onConflict: 'session_id' }
    );

    if (!error) return;

    const unauthorized =
      status === 401 ||
      status === 403 ||
      /row-level security|permission denied|jwt|not authorized/i.test(error.message || '');

    if (unauthorized) {
      sessionLogsWriteBlocked = true;
      noticeSessionLogs('Session log writes disabled (unauthorized for session_logs).', 'info');
      return;
    }

    // Best-effort telemetry: back off on transient failures to avoid noisy retries.
    sessionLogsBackoffUntil = Date.now() + SESSION_LOG_BACKOFF_MS;
    noticeSessionLogs(`Session logs temporarily paused (write failed): ${error.message || 'unknown error'}`, 'info');
  } catch (err) {
    // Network / CORS / offline-ish cases: pause and try later without spamming console.
    sessionLogsBackoffUntil = Date.now() + SESSION_LOG_BACKOFF_MS;
    const message = (err as any)?.message ? String((err as any).message) : String(err);
    noticeSessionLogs(`Session logs temporarily paused (write exception): ${message}`, 'info');
  }
}

async function sendSessionDebrief(reason: 'Session ended' | 'Idle timeout' | 'Tab closed', useBeacon = false) {
  const session = getSession();
  if (!session || !isWatchedSession(session) || isDebriefSent(session.sessionId)) return;

  const durationSeconds = Math.max(0, Math.floor((Date.now() - new Date(session.loginTime).getTime()) / 1000));
  const activitySummary = summarizeRecentActivity(20);
  markDebriefSent(session.sessionId);

  await sendWatchtowerAlert(
    'debrief',
    {
      userName: getUserLabel(session),
      role: session.role,
      code: session.code,
      sessionId: session.sessionId,
      duration: formatDuration(durationSeconds),
      reason,
      actions: activitySummary,
      endedAt: nowIso(),
    },
    useBeacon
  );
}

/** Trigger global force-logout — kicks everyone out */
export async function forceLogoutAll(): Promise<boolean> {
  if (!supabase) return false;

  try {
    const now = nowIso();
    await supabase.from('app_config').upsert(
      { key: 'force_logout_at', value: now, updated_at: now },
      { onConflict: 'key' }
    );

    void sendWatchtowerAlert('force_logout', {
      userName: 'Admin',
      role: 'admin',
      text: 'Global logout triggered by admin',
      timestamp: now,
    });

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
  } catch {
    return false;
  }
}

/** Flush session data periodically + poll for force-logout (call on beforeunload) */
export function setupSessionFlush(onForceLogout: () => void) {
  const flushInterval = setInterval(() => {
    const session = getSession();
    if (session) persistToSupabase(session).catch(() => {});
  }, 30000);

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
