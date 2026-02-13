import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

// Hard-block Supabase network calls in demo mode (2104 guest)
const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    if (SUPABASE_URL) {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const sessionRaw = sessionStorage.getItem('novalyte-session-info');
      const mode = sessionStorage.getItem('novalyte-mode');
      const session = sessionRaw ? JSON.parse(sessionRaw) : null;
      const isDemo2104 = mode === 'demo' && session?.role === 'guest' && session?.code === '2104';

      if (isDemo2104 && requestUrl.startsWith(SUPABASE_URL)) {
        return new Response(JSON.stringify({ error: 'Supabase disabled in demo mode' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
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
