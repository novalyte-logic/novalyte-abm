import { useCallback, useEffect, useMemo, useRef } from 'react';

type GeoInfo = {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  zip?: string | null;
};

type BaseEvent = {
  event_type: string;
  event_data?: Record<string, unknown>;
  time_on_page?: number;
};

export type RealtimeTrackingOptions = {
  ingestUrl: string;
  apiKey?: string;
  heartbeatSeconds?: number;
  trackButtons?: string[];
};

const SESSION_KEY = 'novalyte_rt_session_id';
const SCROLL_MILESTONES = [25, 50, 75, 100];

declare global {
  interface Window {
    __NOVALYTE_GEO__?: GeoInfo;
    __VERCEL_GEO__?: GeoInfo;
  }
}

function getOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function detectDeviceType() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('tablet') || ua.includes('ipad')) return 'tablet';
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) return 'mobile';
  return 'desktop';
}

function detectOS() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac os')) return 'macOS';
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('iphone') || ua.includes('ipad')) return 'iOS';
  if (ua.includes('linux')) return 'Linux';
  return 'Unknown';
}

function detectBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
  return 'Unknown';
}

async function getGeoInfo(): Promise<GeoInfo> {
  if (window.__NOVALYTE_GEO__) return window.__NOVALYTE_GEO__;
  if (window.__VERCEL_GEO__) return window.__VERCEL_GEO__;

  try {
    const res = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
    if (!res.ok) return {};
    const data = await res.json();
    return {
      city: data?.city || null,
      state: data?.region_code || data?.region || null,
      country: data?.country || null,
      lat: Number.isFinite(Number(data?.latitude)) ? Number(data.latitude) : null,
      lng: Number.isFinite(Number(data?.longitude)) ? Number(data.longitude) : null,
      zip: data?.postal || null,
    };
  } catch {
    return {};
  }
}

export function useRealtimeTracking(options: RealtimeTrackingOptions) {
  const { ingestUrl, apiKey, heartbeatSeconds = 10, trackButtons = ['Start Assessment', 'Watch Video'] } = options;

  const sessionIdRef = useRef<string>('');
  const startRef = useRef<number>(Date.now());
  const geoRef = useRef<GeoInfo>({});
  const sentScrollRef = useRef<Set<number>>(new Set());

  const utm = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_content: null,
        utm_term: null,
        gclid: null,
      };
    }
    const p = new URLSearchParams(window.location.search);
    return {
      utm_source: p.get('utm_source'),
      utm_medium: p.get('utm_medium'),
      utm_campaign: p.get('utm_campaign'),
      utm_content: p.get('utm_content'),
      utm_term: p.get('utm_term'),
      gclid: p.get('gclid'),
    };
  }, []);

  const basePayload = useCallback(() => {
    const elapsedSeconds = Math.floor((Date.now() - startRef.current) / 1000);
    return {
      session_id: sessionIdRef.current,
      ...utm,
      referrer: document.referrer || null,
      landing_page: window.location.href,
      geo_city: geoRef.current.city || null,
      geo_state: geoRef.current.state || null,
      geo_country: geoRef.current.country || null,
      geo_zip: geoRef.current.zip || null,
      geo_lat: geoRef.current.lat ?? null,
      geo_lng: geoRef.current.lng ?? null,
      device_type: detectDeviceType(),
      browser: detectBrowser(),
      os: detectOS(),
      screen_width: window.innerWidth,
      screen_height: window.innerHeight,
      time_on_page: elapsedSeconds,
    };
  }, [utm]);

  const sendEvent = useCallback(async (event: BaseEvent) => {
    if (!ingestUrl) return;

    const payload = {
      ...basePayload(),
      event_type: event.event_type,
      event_data: event.event_data || {},
      time_on_page: event.time_on_page ?? basePayload().time_on_page,
    };

    try {
      await fetch(ingestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { apikey: apiKey, Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch {
      // best effort only
    }
  }, [apiKey, basePayload, ingestUrl]);

  const trackInteraction = useCallback((label: string, extra: Record<string, unknown> = {}) => {
    sendEvent({
      event_type: 'interaction',
      event_data: { label, ...extra },
    });
  }, [sendEvent]);

  const trackConversion = useCallback((extra: Record<string, unknown> = {}) => {
    sendEvent({
      event_type: 'conversion',
      event_data: extra,
    });
  }, [sendEvent]);

  useEffect(() => {
    sessionIdRef.current = getOrCreateSessionId();
    startRef.current = Date.now();

    let unmounted = false;
    getGeoInfo().then((geo) => {
      if (unmounted) return;
      geoRef.current = geo;
      sendEvent({
        event_type: 'session_start',
        event_data: {
          path: window.location.pathname,
          utm_term: utm.utm_term || null,
          utm_content: utm.utm_content || null,
          utm_campaign: utm.utm_campaign || null,
          utm_source: utm.utm_source || null,
          gclid: utm.gclid || null,
        },
      });
    });

    const heartbeat = window.setInterval(() => {
      sendEvent({ event_type: 'heartbeat' });
    }, heartbeatSeconds * 1000);

    const onScroll = () => {
      const doc = document.documentElement;
      const total = doc.scrollHeight - doc.clientHeight;
      if (total <= 0) return;
      const percent = Math.min(100, Math.round((window.scrollY / total) * 100));

      for (const step of SCROLL_MILESTONES) {
        if (percent >= step && !sentScrollRef.current.has(step)) {
          sentScrollRef.current.add(step);
          sendEvent({
            event_type: 'scroll_depth',
            event_data: { percent: step },
          });
        }
      }
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const el = target.closest('[data-track],button,a') as HTMLElement | null;
      if (!el) return;

      const tracked = el.getAttribute('data-track') || el.textContent?.trim() || '';
      if (!tracked) return;

      const shouldTrack = trackButtons.some((label) => tracked.toLowerCase().includes(label.toLowerCase()));
      if (!shouldTrack) return;

      sendEvent({
        event_type: 'interaction',
        event_data: {
          label: tracked,
          tag: el.tagName,
          id: el.id || null,
        },
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('click', onClick, { passive: true });

    return () => {
      unmounted = true;
      window.clearInterval(heartbeat);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('click', onClick);
    };
  }, [heartbeatSeconds, sendEvent, trackButtons]);

  return {
    sessionId: sessionIdRef.current,
    trackInteraction,
    trackConversion,
    trackEvent: sendEvent,
  };
}
