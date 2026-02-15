import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

// Hard-block live backend network calls in demo mode (2104 guest).
const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const WATCHTOWER_ALERT_URL =
  ((import.meta as any).env?.VITE_WATCHTOWER_ALERT_URL as string | undefined) ||
  'https://us-central1-warp-486714.cloudfunctions.net/watchtowerAlert';
const BLOCKED_LOG_WINDOW_MS = 120_000;
const blockedLogMap = new Map<string, number>();
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    const requestUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const resolved = new URL(requestUrl, window.location.origin);

    const sessionRaw = sessionStorage.getItem('novalyte-session-info');
    const mode = sessionStorage.getItem('novalyte-mode');
    const session = sessionRaw ? JSON.parse(sessionRaw) : null;
    const isDemo2104 = mode === 'demo' && session?.role === 'guest' && session?.code === '2104';

    if (isDemo2104) {
      // Allow watchtower audit alerts even while demo is offline from live data APIs.
      const isWatchtowerAlertRequest =
        resolved.href.startsWith(WATCHTOWER_ALERT_URL) || resolved.pathname === '/api/slack-alert';

      if (!isWatchtowerAlertRequest) {
        const isSameOrigin = resolved.origin === window.location.origin;
        const isSupabase = SUPABASE_URL ? resolved.href.startsWith(SUPABASE_URL) : false;
        const isExternalBackend = !isSameOrigin || isSupabase;

        if (isExternalBackend) {
          const blockedUrl = `${resolved.origin}${resolved.pathname}`;
          const now = Date.now();
          const lastLoggedAt = blockedLogMap.get(blockedUrl) || 0;
          if (now - lastLoggedAt > BLOCKED_LOG_WINDOW_MS) {
            blockedLogMap.set(blockedUrl, now);
            console.warn('[Demo Guard] Blocked backend request:', blockedUrl);
          }
          return new Response(
            JSON.stringify({ error: 'Backend requests are disabled in demo mode until Go Live.' }),
            {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
      }
    }
  } catch {}

  return nativeFetch(input as any, init);
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#363636',
            color: '#fff',
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>,
);
