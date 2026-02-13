import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import {
  BarChart3, Users, Target,
  RefreshCw, Eye, Globe,
  Clock, Percent, Radio, Zap,
  Hash, ChevronRight, ChevronDown,
} from 'lucide-react';
import { cn } from '../utils/cn';
import { supabase } from '../lib/supabase';
import { ResponsiveContainer, Sankey, Tooltip as RechartsTooltip } from 'recharts';
import type { TrafficMapRef } from './TrafficMap';
import SessionIntelPanel from './SessionIntelPanel';
import FunnelChart from './FunnelChart';
import CampaignTable from './CampaignTable';
import DeviceTechRing from './DeviceTechRing';
import TreatmentDemandBars from './TreatmentDemandBars';
import LeadsTable from './LeadsTable';

const TrafficMap = lazy(() => import('./TrafficMap'));

/* ─── Types ─── */

interface LeadWithAttribution {
  id: string;
  created_at: string;
  name: string;
  email: string;
  phone: string;
  zip_code: string;
  treatment: string;
  source: string;
  status: string;
  match_score: number | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  gclid: string | null;
  referrer: string | null;
  landing_page: string | null;
  geo_city: string | null;
  geo_state: string | null;
  geo_zip: string | null;
  device_type: string | null;
  time_on_page: number | null;
  session_id: string | null;
}

interface PageEvent {
  id: string;
  created_at: string;
  session_id: string;
  event_type: string;
  event_data: Record<string, any>;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  gclid: string | null;
  geo_state: string | null;
  geo_city: string | null;
  geo_lat?: number | null;
  geo_lng?: number | null;
  device_type: string | null;
  browser?: string | null;
  os?: string | null;
  referrer?: string | null;
  landing_page?: string | null;
  time_on_page?: number | null;
}

interface LiveTrafficEvent {
  id: string;
  session_id: string;
  event_type: string;
  created_at: string;
  geo_city: string | null;
  geo_state: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  event_data: Record<string, any>;
}

interface LiveSession {
  sessionId: string;
  lastEvent: string;
  lastEventTime: Date;
  device: string;
  city: string;
  state: string;
  source: string;
  eventsCount: number;
}

interface GeoLocation {
  lat: number;
  lng: number;
  city: string;
  state: string;
  visitors: number;
  leads: number;
  sessions: number;
  topDevice: string;
  topSource: string;
  topTreatment: string;
  lastActivity: Date;
}

type SessionIntelFilter = 'all' | 'navigation' | 'interactions' | 'quiz' | 'conversion' | 'heartbeat';

/* ─── Component ─── */

export default function AdAnalytics() {
  const globeRef = useRef<TrafficMapRef | null>(null);
  const [leads, setLeads] = useState<LeadWithAttribution[]>([]);
  const [pageEvents, setPageEvents] = useState<PageEvent[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [isLive, setIsLive] = useState(false);
  const subscriptionRef = useRef<any>(null);
  const liveTrafficRef = useRef<any>(null);
  const leadsRealtimeRef = useRef<any>(null);
  const inspectorRealtimeRef = useRef<any>(null);
  const [liveTrafficFeed, setLiveTrafficFeed] = useState<LiveTrafficEvent[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorSessionId, setInspectorSessionId] = useState<string | null>(null);
  const [inspectorEvents, setInspectorEvents] = useState<PageEvent[]>([]);
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorFilter, setInspectorFilter] = useState<SessionIntelFilter>('all');
  const [mapSidebarHovered, setMapSidebarHovered] = useState(false);

  /* ─── Data Fetching ─── */

  useEffect(() => {
    fetchLeads();
    fetchPageEvents();
    setupRealtimeSubscription();
    return () => {
      if (subscriptionRef.current) supabase?.removeChannel(subscriptionRef.current);
      if (liveTrafficRef.current) supabase?.removeChannel(liveTrafficRef.current);
      if (leadsRealtimeRef.current) supabase?.removeChannel(leadsRealtimeRef.current);
      if (inspectorRealtimeRef.current) supabase?.removeChannel(inspectorRealtimeRef.current);
    };
  }, [dateRange]);

  const setupRealtimeSubscription = () => {
    if (!supabase) return;
    const channel = supabase
      .channel('page_events_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'page_events' }, (payload) => {
        const e = payload.new as PageEvent;
        setPageEvents(prev => [e, ...prev].slice(0, 1000));
        updateLiveSessions(e);
        setIsLive(true);
        setTimeout(() => setIsLive(false), 3000);
      })
      .subscribe();
    subscriptionRef.current = channel;

    const liveTraffic = supabase
      .channel('live-traffic')
      .on('broadcast', { event: 'traffic' }, ({ payload }) => {
        const createdAt = payload?.created_at || new Date().toISOString();
        const liveEvent: LiveTrafficEvent = {
          id: payload?.id || `live-${payload?.session_id || 'sess'}-${Date.now()}`,
          session_id: payload?.session_id || 'unknown',
          event_type: payload?.event_type || 'page_view',
          created_at: createdAt,
          geo_city: payload?.geo_city || null,
          geo_state: payload?.geo_state || null,
          geo_lat: typeof payload?.geo_lat === 'number' ? payload.geo_lat : null,
          geo_lng: typeof payload?.geo_lng === 'number' ? payload.geo_lng : null,
          event_data: payload?.event_data || {},
        };

        const syntheticPageEvent: PageEvent = {
          id: liveEvent.id,
          created_at: createdAt,
          session_id: liveEvent.session_id,
          event_type: liveEvent.event_type,
          event_data: liveEvent.event_data,
          utm_source: payload?.utm_source || null,
          utm_medium: payload?.utm_medium || null,
          utm_campaign: payload?.utm_campaign || null,
          gclid: payload?.gclid || null,
          geo_state: liveEvent.geo_state,
          geo_city: liveEvent.geo_city,
          geo_lat: liveEvent.geo_lat,
          geo_lng: liveEvent.geo_lng,
          device_type: payload?.device_type || null,
        };

        setPageEvents(prev => [syntheticPageEvent, ...prev].slice(0, 1000));
        setLiveTrafficFeed(prev => [liveEvent, ...prev].slice(0, 40));
        updateLiveSessions(syntheticPageEvent);
        if (liveEvent.event_type === 'conversion' || liveEvent.event_type === 'lead_capture') {
          playConversionTone();
        }

        setIsLive(true);
        setTimeout(() => setIsLive(false), 3000);
      })
      .subscribe();
    liveTrafficRef.current = liveTraffic;

    const leadsChannel = supabase
      .channel('leads_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
        const lead = payload.new as LeadWithAttribution;
        setLeads(prev => {
          if (prev.some(l => l.id === lead.id)) return prev;
          return [lead, ...prev].slice(0, 1000);
        });
      })
      .subscribe();
    leadsRealtimeRef.current = leadsChannel;
  };

  const playConversionTone = () => {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
      setTimeout(() => ctx.close().catch(() => {}), 350);
    } catch {}
  };

  const updateLiveSessions = (event: PageEvent) => {
    setLiveSessions(prev => {
      const existing = prev.find(s => s.sessionId === event.session_id);
      if (existing) {
        return prev.map(s => s.sessionId === event.session_id ? {
          ...s, lastEvent: event.event_type, lastEventTime: new Date(event.created_at), eventsCount: s.eventsCount + 1,
        } : s).sort((a, b) => b.lastEventTime.getTime() - a.lastEventTime.getTime());
      }
      return [{
        sessionId: event.session_id, lastEvent: event.event_type, lastEventTime: new Date(event.created_at),
        device: event.device_type || 'desktop', city: event.geo_city || '', state: event.geo_state || '',
        source: event.gclid ? 'Google Ads' : event.utm_source || 'Organic', eventsCount: 1,
      }, ...prev].slice(0, 30);
    });
  };

  const fetchLeads = async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    try {
      let query = supabase.from('leads').select('*').order('created_at', { ascending: false });
      if (dateRange !== 'all') {
        const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
        const since = new Date(); since.setDate(since.getDate() - days);
        query = query.gte('created_at', since.toISOString());
      }
      const { data } = await query;
      setLeads(data || []);
    } catch (err) { console.error('Failed to fetch leads:', err); }
    setLoading(false);
  };

  const fetchPageEvents = async () => {
    if (!supabase) return;
    try {
      let query = supabase.from('page_events').select('*').order('created_at', { ascending: false }).limit(1000);
      if (dateRange !== 'all') {
        const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
        const since = new Date(); since.setDate(since.getDate() - days);
        query = query.gte('created_at', since.toISOString());
      }
      const { data } = await query;
      setPageEvents(data || []);
      // Build live sessions from last 5 min
      const sessionMap = new Map<string, LiveSession>();
      const cutoff = Date.now() - 5 * 60 * 1000;
      (data || []).forEach((e: PageEvent) => {
        if (new Date(e.created_at).getTime() < cutoff) return;
        const ex = sessionMap.get(e.session_id);
        if (!ex || new Date(e.created_at) > ex.lastEventTime) {
          sessionMap.set(e.session_id, {
            sessionId: e.session_id, lastEvent: e.event_type, lastEventTime: new Date(e.created_at),
            device: e.device_type || 'desktop', city: e.geo_city || '', state: e.geo_state || '',
            source: e.gclid ? 'Google Ads' : e.utm_source || 'Organic', eventsCount: (ex?.eventsCount || 0) + 1,
          });
        }
      });
      setLiveSessions(Array.from(sessionMap.values()).sort((a, b) => b.lastEventTime.getTime() - a.lastEventTime.getTime()).slice(0, 30));
    } catch (err) { console.error('Failed to fetch page events:', err); }
  };

  const refresh = useCallback(() => { fetchLeads(); fetchPageEvents(); }, [dateRange]);

  const liveNowCount = useMemo(() => {
    const cutoff = Date.now() - 2 * 60 * 1000;
    return new Set(
      liveTrafficFeed
        .filter(e => new Date(e.created_at).getTime() >= cutoff)
        .map(e => e.session_id)
    ).size;
  }, [liveTrafficFeed]);

  const describeEvent = (e: PageEvent): string => {
    if (e.event_type === 'session_start') return 'Landed on Home';
    if (e.event_type === 'quiz_start') return 'Started Quiz';
    if (e.event_type === 'quiz_complete') return 'Completed Quiz';
    if (e.event_type === 'lead_capture' || e.event_type === 'conversion') return 'Captured Lead';
    if (e.event_type === 'scroll_depth') return `Scrolled ${String(e.event_data?.percent || '')}%`;
    if (e.event_type === 'interaction') return `Clicked ${String(e.event_data?.label || e.event_data?.section || 'interaction')}`;
    if (e.event_type === 'heartbeat') return `Reading ${String(e.event_data?.section || e.event_data?.label || 'page')}`;
    return String(e.event_data?.label || e.event_data?.section || e.event_type).replace(/_/g, ' ');
  };

  const openSessionInspector = async (sessionId: string) => {
    setInspectorOpen(true);
    setInspectorSessionId(sessionId);
    setInspectorFilter('all');
    setInspectorLoading(true);
    try {
      if (!supabase) {
        setInspectorEvents(pageEvents.filter(e => e.session_id === sessionId).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
        return;
      }
      const { data } = await supabase
        .from('page_events')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(300);
      setInspectorEvents((data || []) as PageEvent[]);
    } catch {
      setInspectorEvents(pageEvents.filter(e => e.session_id === sessionId).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
    } finally {
      setInspectorLoading(false);
    }
  };

  useEffect(() => {
    if (!inspectorOpen || !inspectorSessionId || !supabase) return;

    if (inspectorRealtimeRef.current) {
      supabase.removeChannel(inspectorRealtimeRef.current);
      inspectorRealtimeRef.current = null;
    }

    const channel = supabase
      .channel(`session_intel_${inspectorSessionId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'page_events', filter: `session_id=eq.${inspectorSessionId}` },
        (payload) => {
          const evt = payload.new as PageEvent;
          setInspectorEvents(prev => [...prev, evt].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
        }
      )
      .subscribe();

    inspectorRealtimeRef.current = channel;

    return () => {
      if (inspectorRealtimeRef.current) {
        supabase.removeChannel(inspectorRealtimeRef.current);
        inspectorRealtimeRef.current = null;
      }
    };
  }, [inspectorOpen, inspectorSessionId]);

  /* ─── Computed Metrics ─── */

  const paidLeads = leads.filter(l => l.utm_source || l.gclid);
  const googleAdsLeads = leads.filter(l => l.gclid || l.utm_source === 'google');

  // Unique sessions from page events
  const uniqueSessions = useMemo(() => new Set(pageEvents.map(e => e.session_id)).size, [pageEvents]);

  // Funnel from real page events
  const pageViews = pageEvents.filter(e => e.event_type === 'page_view').length;
  const quizStarts = pageEvents.filter(e => e.event_type === 'quiz_start').length;
  const quizCompletes = pageEvents.filter(e => e.event_type === 'quiz_complete').length;
  const leadCaptures = pageEvents.filter(e => e.event_type === 'lead_capture').length || leads.length;

  // Campaign breakdown
  const campaignLeadRows = useMemo(() => (
    paidLeads.map(l => ({
      id: l.id,
      utm_campaign: l.utm_campaign,
      utm_term: l.utm_term,
      utm_content: l.utm_content,
      status: l.status,
      match_score: l.match_score,
      geo_city: l.geo_city,
      geo_state: l.geo_state,
    }))
  ), [paidLeads]);

  const affluenceSources = useMemo(() => {
    let raw: any[] = [];
    try {
      raw = JSON.parse(localStorage.getItem('novalyte_ai_engine_clinics') || '[]');
    } catch {}

    return raw.map((r: any) => ({
      city: r.city || null,
      state: r.state || null,
      affluence_score: r.affluence_score || null,
    }));
  }, []);

  // Geo locations for map — aggregated from BOTH leads and page_events at city level
  const geoLocations: GeoLocation[] = useMemo(() => {
    const locMap = new Map<string, GeoLocation>();

    const getKey = (city: string | null, state: string | null) => {
      const c = (city || '').trim();
      const s = (state || '').trim();
      if (!c && !s) return null;
      return `${c}|${s}`;
    };

    // From leads
    leads.forEach(l => {
      const key = getKey(l.geo_city, l.geo_state);
      if (!key) return;
      const city = (l.geo_city || '').trim();
      const state = (l.geo_state || '').trim();
      const coords = getCityCoords(city, state);
      if (!coords) return;
      const existing = locMap.get(key);
      if (existing) {
        existing.leads++;
        existing.visitors++;
        if (l.created_at && new Date(l.created_at) > existing.lastActivity) existing.lastActivity = new Date(l.created_at);
      } else {
        locMap.set(key, {
          ...coords, city: city || state, state,
          visitors: 1, leads: 1, sessions: 0,
          topDevice: l.device_type || 'desktop',
          topSource: l.gclid ? 'Google Ads' : l.utm_source || 'Organic',
          topTreatment: l.treatment || '',
          lastActivity: new Date(l.created_at),
        });
      }
    });

    // From page events
    pageEvents.forEach(e => {
      const key = getKey(e.geo_city, e.geo_state);
      if (!key) return;
      const city = (e.geo_city || '').trim();
      const state = (e.geo_state || '').trim();
      const coords = (typeof e.geo_lat === 'number' && typeof e.geo_lng === 'number')
        ? { lat: e.geo_lat, lng: e.geo_lng }
        : getCityCoords(city, state);
      if (!coords) return;
      const existing = locMap.get(key);
      if (existing) {
        existing.visitors++;
        if (e.event_type === 'page_view') existing.sessions++;
        if (new Date(e.created_at) > existing.lastActivity) existing.lastActivity = new Date(e.created_at);
      } else {
        locMap.set(key, {
          ...coords, city: city || state, state,
          visitors: 1, leads: 0, sessions: e.event_type === 'page_view' ? 1 : 0,
          topDevice: e.device_type || 'desktop',
          topSource: e.gclid ? 'Google Ads' : e.utm_source || 'Organic',
          topTreatment: '',
          lastActivity: new Date(e.created_at),
        });
      }
    });

    return Array.from(locMap.values()).sort((a, b) => b.visitors - a.visitors);
  }, [leads, pageEvents]);

  // Device breakdown from page events + leads
  const deviceBreakdown = useMemo(() => {
    const d = { mobile: 0, desktop: 0, tablet: 0 };
    const counted = new Set<string>();
    pageEvents.forEach(e => {
      if (counted.has(e.session_id)) return;
      counted.add(e.session_id);
      const dt = (e.device_type || 'desktop').toLowerCase();
      if (dt === 'mobile') d.mobile++; else if (dt === 'tablet') d.tablet++; else d.desktop++;
    });
    leads.forEach(l => {
      if (l.session_id && counted.has(l.session_id)) return;
      const dt = (l.device_type || 'desktop').toLowerCase();
      if (dt === 'mobile') d.mobile++; else if (dt === 'tablet') d.tablet++; else d.desktop++;
    });
    return d;
  }, [pageEvents, leads]);
  const totalDevices = deviceBreakdown.mobile + deviceBreakdown.desktop + deviceBreakdown.tablet;

  const deviceConversionRates = useMemo(() => {
    const calc = (device: 'mobile' | 'desktop' | 'tablet') => {
      const deviceLeads = leads.filter(l => (l.device_type || 'desktop').toLowerCase() === device);
      if (!deviceLeads.length) return 0;
      const converted = deviceLeads.filter(l => l.status !== 'new').length;
      return Math.round((converted / deviceLeads.length) * 100);
    };
    return {
      mobile: calc('mobile'),
      desktop: calc('desktop'),
      tablet: calc('tablet'),
    };
  }, [leads]);

  // Treatment breakdown
  const topTreatments = useMemo(() => {
    const map = new Map<string, number>();
    leads.forEach(l => { const t = l.treatment || 'Unknown'; map.set(t, (map.get(t) || 0) + 1); });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [leads]);

  // Avg time on page
  const avgTimeOnPage = useMemo(() => {
    const times = leads.filter(l => l.time_on_page).map(l => l.time_on_page!);
    return times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  }, [leads]);

  const totalConversions = leads.filter(l => l.status !== 'new').length;
  const overallConversionRate = leads.length ? Math.round((totalConversions / leads.length) * 100) : 0;

  // Top states from page events + leads
  const topStates = useMemo(() => {
    const map = new Map<string, number>();
    pageEvents.forEach(e => {
      const s = e.geo_state; if (s && s !== 'Unknown') map.set(s, (map.get(s) || 0) + 1);
    });
    leads.forEach(l => {
      const s = l.geo_state; if (s && s !== 'Unknown') map.set(s, (map.get(s) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [pageEvents, leads]);

  // Top cities
  const topCities = useMemo(() => {
    const map = new Map<string, { count: number; state: string }>();
    pageEvents.forEach(e => {
      const c = e.geo_city; if (c && c !== 'Unknown') {
        const ex = map.get(c); map.set(c, { count: (ex?.count || 0) + 1, state: e.geo_state || '' });
      }
    });
    leads.forEach(l => {
      const c = l.geo_city; if (c && c !== 'Unknown') {
        const ex = map.get(c); map.set(c, { count: (ex?.count || 0) + 1, state: l.geo_state || '' });
      }
    });
    return Array.from(map.entries()).map(([city, d]) => ({ city, ...d })).sort((a, b) => b.count - a.count).slice(0, 15);
  }, [pageEvents, leads]);

  /* ─── Render ─── */

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-novalyte-400" />
            Ad Analytics
            {isLive && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-500/20 rounded-full animate-pulse">
                <Radio className="w-3 h-3 text-emerald-400" />
                <span className="text-[10px] text-emerald-400 font-medium">LIVE</span>
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Real-time campaign performance, funnel analytics & geographic intelligence</p>
        </div>
        <div className="flex items-center gap-2">
          {liveSessions.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-emerald-400 font-medium">{liveSessions.length} active</span>
            </div>
          )}
          <div className="flex bg-white/[0.03] rounded-lg p-0.5 border border-white/[0.06]">
            {(['7d', '30d', '90d', 'all'] as const).map(r => (
              <button key={r} onClick={() => setDateRange(r)}
                className={cn('px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                  dateRange === r ? 'bg-novalyte-500/20 text-novalyte-300' : 'text-slate-500 hover:text-slate-300')}>
                {r === 'all' ? 'All' : r}
              </button>
            ))}
          </div>
          <button onClick={refresh} disabled={loading}
            className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors">
            <RefreshCw className={cn('w-4 h-4 text-slate-400', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Live Activity Feed */}
      {liveSessions.length > 0 && (
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            Live Activity
            <span className="text-[10px] text-slate-500 font-normal">Last 5 minutes</span>
          </h2>
          <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
            {liveSessions.map(s => (
              <div key={s.sessionId} className="flex items-center gap-3 p-2 bg-white/[0.02] rounded-lg border border-white/[0.04]">
                <div className={cn('w-2 h-2 rounded-full shrink-0',
                  s.lastEvent === 'lead_capture' ? 'bg-emerald-400' :
                  s.lastEvent === 'quiz_complete' ? 'bg-novalyte-400' :
                  s.lastEvent === 'quiz_start' ? 'bg-amber-400' : 'bg-slate-500'
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-300 font-medium capitalize">{s.lastEvent.replace(/_/g, ' ')}</span>
                    {(s.city || s.state) && <>
                      <span className="text-[10px] text-slate-600">•</span>
                      <span className="text-[10px] text-slate-400">{[s.city, s.state].filter(Boolean).join(', ')}</span>
                    </>}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-600">
                    <span>{s.source}</span><span>•</span><span className="capitalize">{s.device}</span><span>•</span><span>{s.eventsCount} events</span>
                  </div>
                </div>
                <span className="text-[10px] text-slate-500 shrink-0">{formatTimeAgo(s.lastEventTime)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards — 6 columns */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard icon={Eye} label="Page Views" value={pageViews} color="slate" />
        <KPICard icon={Hash} label="Sessions" value={uniqueSessions} color="purple" />
        <KPICard icon={Users} label="Total Leads" value={leads.length} color="novalyte" />
        <KPICard icon={Target} label="Google Ads" value={googleAdsLeads.length} suffix={leads.length ? ` (${Math.round((googleAdsLeads.length / leads.length) * 100)}%)` : ''} color="emerald" />
        <KPICard icon={Percent} label="Conversion Rate" value={overallConversionRate} suffix="%" color="amber" />
        <KPICard icon={Clock} label="Avg Time" value={avgTimeOnPage} suffix="s" color="purple" />
      </div>

      {/* ═══ TRAFFIC MAP — Full Width ═══ */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Globe className="w-4 h-4 text-novalyte-400" />
            Traffic Intelligence Map
            <span className="text-[10px] text-slate-500 font-normal ml-1">
              {geoLocations.length} location{geoLocations.length !== 1 ? 's' : ''} tracked
            </span>
          </h2>
          <span className="text-[10px] text-slate-500">LIVE {liveNowCount} • Hover marker pauses spin • Click marker opens intel</span>
        </div>
        <div className="relative">
          <Suspense fallback={
            <div className="h-[620px] rounded-xl border border-white/[0.08] bg-black flex items-center justify-center">
              <p className="text-xs text-slate-500">Loading 3D Globe...</p>
            </div>
          }>
            <TrafficMap
              ref={globeRef}
              height={620}
              locations={geoLocations}
              liveEvents={liveTrafficFeed}
              onPointSelect={(payload) => {
                const sessionId = payload.sessionId || payload.sessionData[0]?.session_id || null;
                if (sessionId) openSessionInspector(sessionId);
              }}
            />
          </Suspense>

          <div
            className={cn(
              'absolute top-3 right-3 h-[calc(100%-24px)] rounded-xl border border-white/[0.08] bg-black/70 backdrop-blur-xl transition-all duration-300 ease-in-out overflow-hidden',
              mapSidebarHovered ? 'w-[300px]' : 'w-12'
            )}
            onMouseEnter={() => setMapSidebarHovered(true)}
            onMouseLeave={() => setMapSidebarHovered(false)}
          >
            {!mapSidebarHovered ? (
              <div className="h-full flex flex-col items-center pt-3 text-slate-500">
                <span className="text-[10px] [writing-mode:vertical-rl] rotate-180 tracking-wider">INTEL</span>
              </div>
            ) : (
              <div className="h-full overflow-auto p-3 space-y-3">
            {/* Top Cities */}
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Top Cities</p>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {topCities.length === 0 && <p className="text-[10px] text-slate-600 py-2">Awaiting geo data...</p>}
                {topCities.map((c, i) => (
                  <button
                    key={c.city}
                    onClick={() => {
                      if (c.city.toLowerCase() === 'san francisco') {
                        globeRef.current?.flyTo(37.7749, -122.4194, 1.5, 1200);
                        return;
                      }
                      const loc = geoLocations.find(g => g.city === c.city && (c.state ? g.state === c.state : true));
                      if (loc) globeRef.current?.flyTo(loc.lat, loc.lng, 1.5, 1200);
                    }}
                    className="w-full text-left flex items-center gap-2 p-1.5 bg-white/[0.02] rounded-lg hover:bg-white/[0.04] transition-colors"
                  >
                    <span className="w-5 h-5 rounded-full bg-novalyte-500/20 text-novalyte-400 text-[9px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-slate-300 block truncate">{c.city}</span>
                      {c.state && <span className="text-[9px] text-slate-600">{c.state}</span>}
                    </div>
                    <span className="text-[10px] text-novalyte-400 font-semibold">{c.count}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* Top States */}
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Top States</p>
              <div className="space-y-1 max-h-[140px] overflow-y-auto">
                {topStates.length === 0 && <p className="text-[10px] text-slate-600 py-2">Awaiting geo data...</p>}
                {topStates.map(([state, count]) => {
                  const total = pageEvents.length + leads.length;
                  const pct = total ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={state} className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 w-8 truncate">{state}</span>
                      <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                        <div className="h-full bg-novalyte-500/70 rounded-full transition-all" style={{ width: `${Math.max(pct, 3)}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-500 w-6 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Funnel + Campaign Row */}
      <div className="grid lg:grid-cols-2 gap-4">
        <FunnelChart events={pageEvents as any} />
        <CampaignTable leads={campaignLeadRows as any} affluenceSources={affluenceSources as any} />
      </div>

      {/* Bottom Row: Device + Treatment + Sources */}
      <div className="grid md:grid-cols-3 gap-4">
        <DeviceTechRing
          mobile={deviceBreakdown.mobile}
          desktop={deviceBreakdown.desktop}
          tablet={deviceBreakdown.tablet}
          total={totalDevices}
          conversionRates={deviceConversionRates}
        />
        <TreatmentDemandBars
          treatments={topTreatments}
          totalLeads={leads.length}
        />
        <TrafficSourceFlow leads={leads} pageEvents={pageEvents} />
      </div>

      {/* ═══ DETAILED TRAFFIC SOURCES ═══ */}
      <TrafficSourcesDetail leads={leads} pageEvents={pageEvents} />

      <LeadsTable leads={leads as any} />

      <SessionIntelPanel
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        sessionId={inspectorSessionId}
        events={inspectorEvents}
        loading={inspectorLoading}
        activeFilter={inspectorFilter}
        onFilterChange={setInspectorFilter}
        describeEvent={describeEvent}
      />
    </div>
  );
}

/* ─── Sub-components ─── */

function KPICard({ icon: Icon, label, value, suffix, color }: {
  icon: React.ElementType; label: string; value: number; suffix?: string;
  color: 'novalyte' | 'emerald' | 'amber' | 'purple' | 'slate';
}) {
  const colors = {
    novalyte: 'text-novalyte-400 bg-novalyte-500/10',
    emerald: 'text-emerald-400 bg-emerald-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    purple: 'text-purple-400 bg-purple-500/10',
    slate: 'text-slate-400 bg-slate-500/10',
  };
  return (
    <div className="glass-card p-3">
      <div className={cn('p-1.5 rounded-lg w-fit mb-2', colors[color])}><Icon className="w-3.5 h-3.5" /></div>
      <p className="text-xl font-bold text-slate-100">{value.toLocaleString()}{suffix}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/* ─── City/State → Lat/Lng Lookup ─── */

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  // Major metros (target markets)
  'Los Angeles|CA': { lat: 33.9425, lng: -118.2551 },
  'San Diego|CA': { lat: 32.7157, lng: -117.1611 },
  'San Francisco|CA': { lat: 37.7749, lng: -122.4194 },
  'San Jose|CA': { lat: 37.3382, lng: -121.8863 },
  'Sacramento|CA': { lat: 38.5816, lng: -121.4944 },
  'Irvine|CA': { lat: 33.6846, lng: -117.8265 },
  'Newport Beach|CA': { lat: 33.6189, lng: -117.9289 },
  'Beverly Hills|CA': { lat: 34.0736, lng: -118.4004 },
  'Miami|FL': { lat: 25.7617, lng: -80.1918 },
  'Fort Lauderdale|FL': { lat: 26.1224, lng: -80.1373 },
  'Tampa|FL': { lat: 27.9506, lng: -82.4572 },
  'Orlando|FL': { lat: 28.5383, lng: -81.3792 },
  'Jacksonville|FL': { lat: 30.3322, lng: -81.6557 },
  'Naples|FL': { lat: 26.1420, lng: -81.7948 },
  'Scottsdale|AZ': { lat: 33.4942, lng: -111.9261 },
  'Phoenix|AZ': { lat: 33.4484, lng: -112.0740 },
  'Tucson|AZ': { lat: 32.2226, lng: -110.9747 },
  'Houston|TX': { lat: 29.7604, lng: -95.3698 },
  'Dallas|TX': { lat: 32.7767, lng: -96.7970 },
  'Austin|TX': { lat: 30.2672, lng: -97.7431 },
  'San Antonio|TX': { lat: 29.4241, lng: -98.4936 },
  'Denver|CO': { lat: 39.7392, lng: -104.9903 },
  'Boulder|CO': { lat: 40.0150, lng: -105.2705 },
  'New York|NY': { lat: 40.7128, lng: -74.0060 },
  'Manhattan|NY': { lat: 40.7831, lng: -73.9712 },
  'Brooklyn|NY': { lat: 40.6782, lng: -73.9442 },
  'Chicago|IL': { lat: 41.8781, lng: -87.6298 },
  'Atlanta|GA': { lat: 33.7490, lng: -84.3880 },
  'Nashville|TN': { lat: 36.1627, lng: -86.7816 },
  'Charlotte|NC': { lat: 35.2271, lng: -80.8431 },
  'Raleigh|NC': { lat: 35.7796, lng: -78.6382 },
  'Seattle|WA': { lat: 47.6062, lng: -122.3321 },
  'Portland|OR': { lat: 45.5152, lng: -122.6784 },
  'Las Vegas|NV': { lat: 36.1699, lng: -115.1398 },
  'Boston|MA': { lat: 42.3601, lng: -71.0589 },
  'Washington|DC': { lat: 38.9072, lng: -77.0369 },
  'Philadelphia|PA': { lat: 39.9526, lng: -75.1652 },
  'Minneapolis|MN': { lat: 44.9778, lng: -93.2650 },
  'Detroit|MI': { lat: 42.3314, lng: -83.0458 },
  'Salt Lake City|UT': { lat: 40.7608, lng: -111.8910 },
  'Hartford|CT': { lat: 41.7658, lng: -72.6734 },
  'Stamford|CT': { lat: 41.0534, lng: -73.5387 },
  'Greenwich|CT': { lat: 41.0262, lng: -73.6282 },
  'Indianapolis|IN': { lat: 39.7684, lng: -86.1581 },
  'Columbus|OH': { lat: 39.9612, lng: -82.9988 },
  'Pittsburgh|PA': { lat: 40.4406, lng: -79.9959 },
  'St. Louis|MO': { lat: 38.6270, lng: -90.1994 },
  'Kansas City|MO': { lat: 39.0997, lng: -94.5786 },
  'New Orleans|LA': { lat: 29.9511, lng: -90.0715 },
  'Baltimore|MD': { lat: 39.2904, lng: -76.6122 },
  'Richmond|VA': { lat: 37.5407, lng: -77.4360 },
  'Virginia Beach|VA': { lat: 36.8529, lng: -75.9780 },
  'Honolulu|HI': { lat: 21.3069, lng: -157.8583 },
};

const STATE_COORDS: Record<string, { lat: number; lng: number }> = {
  'AL': { lat: 32.81, lng: -86.79 }, 'AK': { lat: 61.37, lng: -152.40 },
  'AZ': { lat: 33.73, lng: -111.43 }, 'AR': { lat: 34.97, lng: -92.37 },
  'CA': { lat: 36.12, lng: -119.68 }, 'CO': { lat: 39.06, lng: -105.31 },
  'CT': { lat: 41.60, lng: -72.76 }, 'DE': { lat: 39.32, lng: -75.51 },
  'FL': { lat: 27.77, lng: -81.69 }, 'GA': { lat: 33.04, lng: -83.64 },
  'HI': { lat: 21.09, lng: -157.50 }, 'ID': { lat: 44.24, lng: -114.48 },
  'IL': { lat: 40.35, lng: -88.99 }, 'IN': { lat: 39.85, lng: -86.26 },
  'IA': { lat: 42.01, lng: -93.21 }, 'KS': { lat: 38.53, lng: -96.73 },
  'KY': { lat: 37.67, lng: -84.67 }, 'LA': { lat: 31.17, lng: -91.87 },
  'ME': { lat: 44.69, lng: -69.38 }, 'MD': { lat: 39.06, lng: -76.80 },
  'MA': { lat: 42.23, lng: -71.53 }, 'MI': { lat: 43.33, lng: -84.54 },
  'MN': { lat: 45.69, lng: -93.90 }, 'MS': { lat: 32.74, lng: -89.68 },
  'MO': { lat: 38.46, lng: -92.29 }, 'MT': { lat: 46.92, lng: -110.45 },
  'NE': { lat: 41.13, lng: -98.27 }, 'NV': { lat: 38.31, lng: -117.06 },
  'NH': { lat: 43.45, lng: -71.56 }, 'NJ': { lat: 40.30, lng: -74.52 },
  'NM': { lat: 34.84, lng: -106.25 }, 'NY': { lat: 42.17, lng: -74.95 },
  'NC': { lat: 35.63, lng: -79.81 }, 'ND': { lat: 47.53, lng: -99.78 },
  'OH': { lat: 40.39, lng: -82.76 }, 'OK': { lat: 35.57, lng: -96.93 },
  'OR': { lat: 44.57, lng: -122.07 }, 'PA': { lat: 40.59, lng: -77.21 },
  'RI': { lat: 41.68, lng: -71.51 }, 'SC': { lat: 33.86, lng: -80.95 },
  'SD': { lat: 44.30, lng: -99.44 }, 'TN': { lat: 35.75, lng: -86.69 },
  'TX': { lat: 31.05, lng: -97.56 }, 'UT': { lat: 40.15, lng: -111.86 },
  'VT': { lat: 44.05, lng: -72.71 }, 'VA': { lat: 37.77, lng: -78.17 },
  'WA': { lat: 47.40, lng: -121.49 }, 'WV': { lat: 38.49, lng: -80.95 },
  'WI': { lat: 44.27, lng: -89.62 }, 'WY': { lat: 42.76, lng: -107.30 },
  'DC': { lat: 38.90, lng: -77.03 },
  // Full names
  'Alabama': { lat: 32.81, lng: -86.79 }, 'Alaska': { lat: 61.37, lng: -152.40 },
  'Arizona': { lat: 33.73, lng: -111.43 }, 'Arkansas': { lat: 34.97, lng: -92.37 },
  'California': { lat: 36.12, lng: -119.68 }, 'Colorado': { lat: 39.06, lng: -105.31 },
  'Connecticut': { lat: 41.60, lng: -72.76 }, 'Delaware': { lat: 39.32, lng: -75.51 },
  'Florida': { lat: 27.77, lng: -81.69 }, 'Georgia': { lat: 33.04, lng: -83.64 },
  'Hawaii': { lat: 21.09, lng: -157.50 }, 'Idaho': { lat: 44.24, lng: -114.48 },
  'Illinois': { lat: 40.35, lng: -88.99 }, 'Indiana': { lat: 39.85, lng: -86.26 },
  'Iowa': { lat: 42.01, lng: -93.21 }, 'Kansas': { lat: 38.53, lng: -96.73 },
  'Kentucky': { lat: 37.67, lng: -84.67 }, 'Louisiana': { lat: 31.17, lng: -91.87 },
  'Maine': { lat: 44.69, lng: -69.38 }, 'Maryland': { lat: 39.06, lng: -76.80 },
  'Massachusetts': { lat: 42.23, lng: -71.53 }, 'Michigan': { lat: 43.33, lng: -84.54 },
  'Minnesota': { lat: 45.69, lng: -93.90 }, 'Mississippi': { lat: 32.74, lng: -89.68 },
  'Missouri': { lat: 38.46, lng: -92.29 }, 'Montana': { lat: 46.92, lng: -110.45 },
  'Nebraska': { lat: 41.13, lng: -98.27 }, 'Nevada': { lat: 38.31, lng: -117.06 },
  'New Hampshire': { lat: 43.45, lng: -71.56 }, 'New Jersey': { lat: 40.30, lng: -74.52 },
  'New Mexico': { lat: 34.84, lng: -106.25 }, 'New York': { lat: 42.17, lng: -74.95 },
  'North Carolina': { lat: 35.63, lng: -79.81 }, 'North Dakota': { lat: 47.53, lng: -99.78 },
  'Ohio': { lat: 40.39, lng: -82.76 }, 'Oklahoma': { lat: 35.57, lng: -96.93 },
  'Oregon': { lat: 44.57, lng: -122.07 }, 'Pennsylvania': { lat: 40.59, lng: -77.21 },
  'Rhode Island': { lat: 41.68, lng: -71.51 }, 'South Carolina': { lat: 33.86, lng: -80.95 },
  'South Dakota': { lat: 44.30, lng: -99.44 }, 'Tennessee': { lat: 35.75, lng: -86.69 },
  'Texas': { lat: 31.05, lng: -97.56 }, 'Utah': { lat: 40.15, lng: -111.86 },
  'Vermont': { lat: 44.05, lng: -72.71 }, 'Virginia': { lat: 37.77, lng: -78.17 },
  'Washington': { lat: 47.40, lng: -121.49 }, 'West Virginia': { lat: 38.49, lng: -80.95 },
  'Wisconsin': { lat: 44.27, lng: -89.62 }, 'Wyoming': { lat: 42.76, lng: -107.30 },
};

function getCityCoords(city: string, state: string): { lat: number; lng: number } | null {
  // Try city|state first
  const cityKey = `${city}|${state}`;
  if (CITY_COORDS[cityKey]) return CITY_COORDS[cityKey];
  // Try state fallback
  if (STATE_COORDS[state]) return STATE_COORDS[state];
  return null;
}

/* ─── Detailed Traffic Sources Component ─── */

type SourceName = 'Google Ads' | 'Organic' | 'Direct';

interface KeywordMetrics {
  name: string;
  sessions: number;
  leads: number;
  bounce: number;
}

interface CampaignMetrics {
  name: string;
  sessions: number;
  leads: number;
  bounce: number;
  keywords: KeywordMetrics[];
}

interface SourceMetrics {
  name: SourceName;
  sessions: number;
  leads: number;
  bounce: number;
  campaigns: CampaignMetrics[];
}

function classifySource(rawSource?: string | null, rawMedium?: string | null, gclid?: string | null): SourceName {
  const source = (rawSource || '').toLowerCase();
  const medium = (rawMedium || '').toLowerCase();

  if (gclid || (source === 'google' && (medium === 'cpc' || medium === 'ppc' || medium === 'paid'))) return 'Google Ads';
  if (!source || source === '(direct)' || source === 'direct') return 'Direct';
  return 'Organic';
}

function buildTrafficTree(leads: LeadWithAttribution[], pageEvents: PageEvent[]): SourceMetrics[] {
  const tree = new Map<SourceName, { sessions: number; leads: number; campaigns: Map<string, { sessions: number; leads: number; keywords: Map<string, { sessions: number; leads: number }> }> }>();

  const ensureSource = (source: SourceName) => {
    if (!tree.has(source)) tree.set(source, { sessions: 0, leads: 0, campaigns: new Map() });
    return tree.get(source)!;
  };
  const ensureCampaign = (sourceNode: ReturnType<typeof ensureSource>, campaign: string) => {
    if (!sourceNode.campaigns.has(campaign)) sourceNode.campaigns.set(campaign, { sessions: 0, leads: 0, keywords: new Map() });
    return sourceNode.campaigns.get(campaign)!;
  };
  const ensureKeyword = (campaignNode: ReturnType<typeof ensureCampaign>, keyword: string) => {
    if (!campaignNode.keywords.has(keyword)) campaignNode.keywords.set(keyword, { sessions: 0, leads: 0 });
    return campaignNode.keywords.get(keyword)!;
  };

  const bySession = new Map<string, { source: SourceName; campaign: string; keyword: string }>();
  pageEvents.forEach((e) => {
    if (!e.session_id || bySession.has(e.session_id)) return;
    bySession.set(e.session_id, {
      source: classifySource(e.utm_source, e.utm_medium, e.gclid),
      campaign: e.utm_campaign || String((e.event_data as any)?.utm_campaign || 'Unattributed'),
      keyword: String((e.event_data as any)?.utm_term || '(no keyword)'),
    });
  });

  bySession.forEach(({ source, campaign, keyword }) => {
    const sourceNode = ensureSource(source);
    sourceNode.sessions += 1;
    const campaignNode = ensureCampaign(sourceNode, campaign);
    campaignNode.sessions += 1;
    const keywordNode = ensureKeyword(campaignNode, keyword);
    keywordNode.sessions += 1;
  });

  leads.forEach((lead) => {
    const source = classifySource(lead.utm_source, lead.utm_medium, lead.gclid);
    const campaign = lead.utm_campaign || 'Unattributed';
    const keyword = lead.utm_term || '(no keyword)';
    const sourceNode = ensureSource(source);
    sourceNode.leads += 1;
    const campaignNode = ensureCampaign(sourceNode, campaign);
    campaignNode.leads += 1;
    const keywordNode = ensureKeyword(campaignNode, keyword);
    keywordNode.leads += 1;
  });

  const normalize = (sessions: number, leadsCount: number) => Math.max(0, sessions - leadsCount);
  const sourceOrder: SourceName[] = ['Google Ads', 'Organic', 'Direct'];

  return sourceOrder.map((name) => {
    const source = ensureSource(name);
    const campaigns = Array.from(source.campaigns.entries())
      .map(([campaignName, campaignNode]): CampaignMetrics => {
        const keywords = Array.from(campaignNode.keywords.entries())
          .map(([keywordName, keywordNode]): KeywordMetrics => ({
            name: keywordName,
            sessions: keywordNode.sessions,
            leads: keywordNode.leads,
            bounce: normalize(keywordNode.sessions, keywordNode.leads),
          }))
          .sort((a, b) => b.sessions - a.sessions || b.leads - a.leads);

        return {
          name: campaignName,
          sessions: campaignNode.sessions,
          leads: campaignNode.leads,
          bounce: normalize(campaignNode.sessions, campaignNode.leads),
          keywords,
        };
      })
      .sort((a, b) => b.sessions - a.sessions || b.leads - a.leads);

    return {
      name,
      sessions: source.sessions,
      leads: source.leads,
      bounce: normalize(source.sessions, source.leads),
      campaigns,
    };
  });
}

function pctBounce(sessions: number, bounce: number) {
  if (!sessions) return '0%';
  return `${Math.round((bounce / sessions) * 100)}%`;
}

function SankeyNode(props: any) {
  const { x, y, width, height, payload } = props;
  const label = payload?.name || '';

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill="rgba(59,130,246,0.35)" stroke="rgba(147,197,253,0.7)" />
      <text x={x + width + 8} y={y + height / 2} fill="#cbd5e1" fontSize={11} dominantBaseline="middle">
        {label}
      </text>
    </g>
  );
}

function SankeyFlowLink(props: any) {
  const { sourceX, sourceY, targetX, targetY, linkWidth, payload } = props;
  const isLead = String(payload?.target?.name || '').toLowerCase().includes('lead');
  const midX = (sourceX + targetX) / 2;
  const path = `M${sourceX},${sourceY} C${midX},${sourceY} ${midX},${targetY} ${targetX},${targetY}`;
  const stroke = isLead ? 'rgba(34,197,94,0.9)' : 'rgba(248,113,113,0.85)';

  return (
    <path d={path} fill="none" stroke={stroke} strokeWidth={Math.max(linkWidth, 2)} strokeLinecap="round" strokeDasharray="9 7">
      <animate attributeName="stroke-dashoffset" from="16" to="0" dur="1.1s" repeatCount="indefinite" />
    </path>
  );
}

function TrafficSourceFlow({ leads, pageEvents }: { leads: LeadWithAttribution[]; pageEvents: PageEvent[] }) {
  const tree = useMemo(() => buildTrafficTree(leads, pageEvents), [leads, pageEvents]);
  const sankeyData = useMemo(() => {
    const activeSources = tree.filter(s => s.sessions > 0 || s.leads > 0);
    const campaigns = activeSources.flatMap(s =>
      s.campaigns.slice(0, 4).map(c => ({ ...c, source: s.name, key: `${s.name}::${c.name}` }))
    );

    const nodes: Array<{ name: string }> = [
      ...activeSources.map(s => ({ name: s.name })),
      ...campaigns.map(c => ({ name: c.key })),
      { name: 'Lead' },
      { name: 'Bounce' },
    ];

    const nodeIndex = new Map(nodes.map((n, i) => [n.name, i]));
    const links: Array<{ source: number; target: number; value: number }> = [];

    campaigns.forEach((campaign) => {
      const sourceIndex = nodeIndex.get(campaign.source);
      const campaignIndex = nodeIndex.get(campaign.key);
      const leadIndex = nodeIndex.get('Lead');
      const bounceIndex = nodeIndex.get('Bounce');
      if (sourceIndex == null || campaignIndex == null || leadIndex == null || bounceIndex == null) return;

      const inFlow = Math.max(campaign.sessions, campaign.leads);
      if (inFlow > 0) links.push({ source: sourceIndex, target: campaignIndex, value: inFlow });
      if (campaign.leads > 0) links.push({ source: campaignIndex, target: leadIndex, value: campaign.leads });
      if (campaign.bounce > 0) links.push({ source: campaignIndex, target: bounceIndex, value: campaign.bounce });
    });

    return {
      nodes: nodes.map(n => ({ name: n.name.includes('::') ? n.name.split('::')[1] : n.name })),
      links,
    };
  }, [tree]);

  return (
    <div className="glass-card p-4 h-full">
      <h2 className="text-sm font-semibold text-slate-200 mb-2">Source Sankey</h2>
      <p className="text-[10px] text-slate-500 mb-3">Source → Campaign → Lead/Bounce</p>
      <div className="h-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={sankeyData as any}
            nodePadding={16}
            nodeWidth={12}
            iterations={24}
            margin={{ top: 8, right: 80, left: 8, bottom: 8 }}
            node={SankeyNode}
            link={SankeyFlowLink}
          >
            <RechartsTooltip
              cursor={false}
              contentStyle={{
                background: 'rgba(2,6,23,0.94)',
                border: '1px solid rgba(148,163,184,0.25)',
                borderRadius: 10,
                color: '#e2e8f0',
              }}
              formatter={(value: any) => [`${Number(value || 0)} sessions`, 'Flow']}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TrafficSourcesDetail({ leads, pageEvents }: { leads: LeadWithAttribution[]; pageEvents: PageEvent[] }) {
  const tree = useMemo(() => buildTrafficTree(leads, pageEvents), [leads, pageEvents]);
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({});
  const [openCampaigns, setOpenCampaigns] = useState<Record<string, boolean>>({});

  return (
    <div className="glass-card p-4">
      <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Globe className="w-4 h-4 text-novalyte-400" />
        Traffic Sources Drill-Down
        <span className="text-[10px] text-slate-500 font-normal ml-1">Expand Source → Campaign → Keyword</span>
      </h2>

      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <div className="grid grid-cols-[1fr_100px_110px_80px] bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500">
          <span>Channel</span>
          <span className="text-right">Sessions</span>
          <span className="text-right">Bounce Rate</span>
          <span className="text-right">Leads</span>
        </div>

        <div className="divide-y divide-white/[0.04]">
          {tree.map((source) => {
            const sourceOpen = !!openSources[source.name];
            return (
              <div key={source.name}>
                <button
                  onClick={() => setOpenSources(prev => ({ ...prev, [source.name]: !prev[source.name] }))}
                  className="w-full grid grid-cols-[1fr_100px_110px_80px] px-3 py-2 text-sm text-left hover:bg-white/[0.02] transition-colors"
                >
                  <span className="flex items-center gap-2 text-slate-200 font-medium">
                    {sourceOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                    {source.name}
                  </span>
                  <span className="text-right text-slate-300 tabular-nums">{source.sessions}</span>
                  <span className="text-right text-slate-400 tabular-nums">{pctBounce(source.sessions, source.bounce)}</span>
                  <span className="text-right text-emerald-400 tabular-nums font-semibold">{source.leads}</span>
                </button>

                {sourceOpen && source.campaigns.map((campaign) => {
                  const key = `${source.name}::${campaign.name}`;
                  const campaignOpen = !!openCampaigns[key];
                  return (
                    <div key={key}>
                      <button
                        onClick={() => setOpenCampaigns(prev => ({ ...prev, [key]: !prev[key] }))}
                        className="w-full grid grid-cols-[1fr_100px_110px_80px] px-3 py-2 text-xs text-left bg-white/[0.015] hover:bg-white/[0.03] transition-colors"
                      >
                        <span className="flex items-center gap-2 text-slate-300 pl-6">
                          {campaignOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-600" />}
                          {campaign.name}
                        </span>
                        <span className="text-right text-slate-400 tabular-nums">{campaign.sessions}</span>
                        <span className="text-right text-slate-500 tabular-nums">{pctBounce(campaign.sessions, campaign.bounce)}</span>
                        <span className="text-right text-emerald-400 tabular-nums">{campaign.leads}</span>
                      </button>

                      {campaignOpen && campaign.keywords.map((keyword) => (
                        <div key={`${key}::${keyword.name}`} className="grid grid-cols-[1fr_100px_110px_80px] px-3 py-2 text-xs bg-black/20">
                          <span className="text-slate-400 pl-12 truncate">{keyword.name}</span>
                          <span className="text-right text-slate-500 tabular-nums">{keyword.sessions}</span>
                          <span className="text-right text-slate-600 tabular-nums">{pctBounce(keyword.sessions, keyword.bounce)}</span>
                          <span className="text-right text-emerald-500 tabular-nums">{keyword.leads}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
