import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  BarChart3, TrendingUp, MousePointerClick, Users, Target, MapPin,
  RefreshCw, Eye, Play, CheckCircle, UserPlus, Globe,
  Smartphone, Monitor, Tablet, Clock, Percent, Radio, Zap,
  Activity, Hash,
} from 'lucide-react';
import { cn } from '../utils/cn';
import { supabase } from '../lib/supabase';

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
  utm_campaign: string | null;
  gclid: string | null;
  geo_state: string | null;
  geo_city: string | null;
  device_type: string | null;
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

/* ─── Component ─── */

export default function AdAnalytics() {
  const [leads, setLeads] = useState<LeadWithAttribution[]>([]);
  const [pageEvents, setPageEvents] = useState<PageEvent[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [isLive, setIsLive] = useState(false);
  const subscriptionRef = useRef<any>(null);

  /* ─── Data Fetching ─── */

  useEffect(() => {
    fetchLeads();
    fetchPageEvents();
    setupRealtimeSubscription();
    return () => {
      if (subscriptionRef.current) supabase?.removeChannel(subscriptionRef.current);
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

  /* ─── Computed Metrics ─── */

  const paidLeads = leads.filter(l => l.utm_source || l.gclid);
  const googleAdsLeads = leads.filter(l => l.gclid || l.utm_source === 'google');
  const organicLeads = leads.filter(l => !l.utm_source && !l.gclid);

  // Unique sessions from page events
  const uniqueSessions = useMemo(() => new Set(pageEvents.map(e => e.session_id)).size, [pageEvents]);

  // Funnel from real page events
  const pageViews = pageEvents.filter(e => e.event_type === 'page_view').length;
  const quizStarts = pageEvents.filter(e => e.event_type === 'quiz_start').length;
  const quizCompletes = pageEvents.filter(e => e.event_type === 'quiz_complete').length;
  const leadCaptures = pageEvents.filter(e => e.event_type === 'lead_capture').length || leads.length;

  // Campaign breakdown
  const campaignMetrics = useMemo(() => {
    const map = new Map<string, LeadWithAttribution[]>();
    paidLeads.forEach(l => {
      const c = l.utm_campaign || 'Unknown Campaign';
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push(l);
    });
    return Array.from(map.entries()).map(([campaign, cls]) => {
      const conversions = cls.filter(l => l.status !== 'new').length;
      const devices = { mobile: 0, desktop: 0, tablet: 0 };
      cls.forEach(l => { const d = (l.device_type || 'desktop').toLowerCase(); if (d === 'mobile') devices.mobile++; else if (d === 'tablet') devices.tablet++; else devices.desktop++; });
      const scores = cls.filter(l => l.match_score).map(l => l.match_score!);
      return {
        campaign, leads: cls.length, conversions,
        conversionRate: cls.length ? Math.round((conversions / cls.length) * 100) : 0,
        avgMatchScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
        devices,
      };
    }).sort((a, b) => b.leads - a.leads);
  }, [paidLeads]);

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
      const coords = getCityCoords(city, state);
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
          {geoLocations.length > 0 && (
            <span className="text-[10px] text-slate-500">Hover markers for details • Click to zoom</span>
          )}
        </div>
        <div className="grid lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3">
            <TrafficMap locations={geoLocations} apiKey={import.meta.env.VITE_GOOGLE_PLACES_API_KEY} />
          </div>
          <div className="space-y-3">
            {/* Top Cities */}
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Top Cities</p>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {topCities.length === 0 && <p className="text-[10px] text-slate-600 py-2">Awaiting geo data...</p>}
                {topCities.map((c, i) => (
                  <div key={c.city} className="flex items-center gap-2 p-1.5 bg-white/[0.02] rounded-lg hover:bg-white/[0.04] transition-colors">
                    <span className="w-5 h-5 rounded-full bg-novalyte-500/20 text-novalyte-400 text-[9px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-slate-300 block truncate">{c.city}</span>
                      {c.state && <span className="text-[9px] text-slate-600">{c.state}</span>}
                    </div>
                    <span className="text-[10px] text-novalyte-400 font-semibold">{c.count}</span>
                  </div>
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
        </div>
      </div>

      {/* Funnel + Campaign Row */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Funnel */}
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-novalyte-400" />
            Landing Page Funnel
          </h2>
          <div className="flex items-end justify-between gap-3 h-36">
            {[
              { name: 'Page Views', count: pageViews, icon: Eye, color: 'bg-slate-600' },
              { name: 'Quiz Started', count: quizStarts, icon: Play, color: 'bg-novalyte-600' },
              { name: 'Quiz Completed', count: quizCompletes, icon: CheckCircle, color: 'bg-novalyte-500' },
              { name: 'Lead Captured', count: leadCaptures, icon: UserPlus, color: 'bg-emerald-500' },
            ].map((step, i) => {
              const Icon = step.icon;
              const rate = pageViews ? Math.round((step.count / pageViews) * 100) : (i === 0 ? 100 : 0);
              const h = Math.max(rate, 5);
              return (
                <div key={step.name} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="text-xs text-slate-400 font-medium">{step.count.toLocaleString()}</div>
                  <div className="w-full bg-white/[0.03] rounded-t-lg relative overflow-hidden" style={{ height: `${h}%` }}>
                    <div className={cn('absolute inset-0 rounded-t-lg', step.color)} />
                  </div>
                  <Icon className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-[9px] text-slate-500 text-center leading-tight">{step.name}</span>
                  <span className="text-[9px] text-slate-600">{rate}%</span>
                </div>
              );
            })}
          </div>
          {/* Drop-off rates */}
          <div className="flex justify-between mt-3 pt-3 border-t border-white/[0.04]">
            {[
              { label: 'View→Start', from: pageViews, to: quizStarts },
              { label: 'Start→Complete', from: quizStarts, to: quizCompletes },
              { label: 'Complete→Lead', from: quizCompletes, to: leadCaptures },
            ].map(d => {
              const rate = d.from ? Math.round((d.to / d.from) * 100) : 0;
              return (
                <div key={d.label} className="text-center">
                  <div className={cn('text-xs font-semibold', rate >= 50 ? 'text-emerald-400' : rate >= 25 ? 'text-amber-400' : 'text-red-400')}>{rate}%</div>
                  <div className="text-[9px] text-slate-600">{d.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Campaign Performance */}
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <MousePointerClick className="w-4 h-4 text-novalyte-400" />
            Campaign Performance
          </h2>
          {campaignMetrics.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Activity className="w-8 h-8 text-slate-700 mb-2" />
              <p className="text-xs text-slate-500">No campaign data yet</p>
              <p className="text-[10px] text-slate-600 mt-1">Run Google Ads with UTM parameters to see data here</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {campaignMetrics.map(c => (
                <div key={c.campaign} className="p-3 bg-white/[0.02] rounded-lg border border-white/[0.04] hover:border-novalyte-500/20 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-slate-200 truncate flex-1">{c.campaign}</span>
                    <span className="text-xs text-novalyte-400 font-semibold ml-2">{c.leads} leads</span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1"><Percent className="w-3 h-3" /> {c.conversionRate}%</span>
                    <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {c.avgMatchScore}% match</span>
                    <span className="flex items-center gap-1"><Smartphone className="w-3 h-3" />{c.devices.mobile} <Monitor className="w-3 h-3 ml-1" />{c.devices.desktop}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: Device + Treatment + Sources */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Device Breakdown</h2>
          <div className="space-y-3">
            {[
              { icon: Smartphone, label: 'Mobile', count: deviceBreakdown.mobile },
              { icon: Monitor, label: 'Desktop', count: deviceBreakdown.desktop },
              { icon: Tablet, label: 'Tablet', count: deviceBreakdown.tablet },
            ].map(d => {
              const pct = totalDevices ? Math.round((d.count / totalDevices) * 100) : 0;
              return (
                <div key={d.label} className="flex items-center gap-3">
                  <d.icon className="w-4 h-4 text-slate-500" />
                  <span className="text-xs text-slate-300 flex-1">{d.label}</span>
                  <div className="w-16 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                    <div className="h-full bg-novalyte-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-500 w-10 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Treatment Interest</h2>
          <div className="space-y-2">
            {topTreatments.slice(0, 5).map(([treatment, count]) => {
              const pct = leads.length ? Math.round((count / leads.length) * 100) : 0;
              return (
                <div key={treatment} className="flex items-center gap-2">
                  <span className="text-xs text-slate-300 flex-1 truncate capitalize">{treatment}</span>
                  <span className="text-[10px] text-novalyte-400 font-medium">{pct}%</span>
                  <span className="text-[10px] text-slate-500">({count})</span>
                </div>
              );
            })}
            {topTreatments.length === 0 && <p className="text-[10px] text-slate-600 py-2">No data yet</p>}
          </div>
        </div>
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Traffic Sources</h2>
          <div className="space-y-2">
            {[
              { label: 'Google Ads', count: googleAdsLeads.length, color: 'bg-emerald-500' },
              { label: 'Other Paid', count: paidLeads.length - googleAdsLeads.length, color: 'bg-amber-500' },
              { label: 'Organic', count: organicLeads.length, color: 'bg-slate-500' },
            ].map(s => {
              const pct = leads.length ? Math.round((s.count / leads.length) * 100) : 0;
              return (
                <div key={s.label} className="flex items-center gap-2">
                  <div className={cn('w-2 h-2 rounded-full', s.color)} />
                  <span className="text-xs text-slate-300 flex-1">{s.label}</span>
                  <span className="text-[10px] text-slate-500">{s.count}</span>
                  <span className="text-[10px] text-slate-400 font-medium w-8 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent Leads Table */}
      <div className="glass-card p-4">
        <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-novalyte-400" />
          Recent Leads with Attribution
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-white/[0.06]">
                <th className="text-left py-2 px-2 font-medium">Lead</th>
                <th className="text-left py-2 px-2 font-medium">Source</th>
                <th className="text-left py-2 px-2 font-medium">Campaign</th>
                <th className="text-left py-2 px-2 font-medium">Location</th>
                <th className="text-left py-2 px-2 font-medium">Device</th>
                <th className="text-left py-2 px-2 font-medium">Score</th>
                <th className="text-left py-2 px-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {leads.slice(0, 25).map(lead => (
                <tr key={lead.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="py-2 px-2">
                    <div className="text-slate-200 font-medium">{lead.name || 'Unknown'}</div>
                    <div className="text-slate-500 text-[10px]">{lead.email}</div>
                  </td>
                  <td className="py-2 px-2">
                    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium',
                      lead.gclid ? 'bg-emerald-500/20 text-emerald-400' :
                      lead.utm_source ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-500/20 text-slate-400'
                    )}>{lead.gclid ? 'Google Ads' : lead.utm_source || 'Organic'}</span>
                  </td>
                  <td className="py-2 px-2 text-slate-400 max-w-[120px] truncate">{lead.utm_campaign || '—'}</td>
                  <td className="py-2 px-2">
                    <div className="text-slate-300 text-[11px]">{lead.geo_city || '—'}</div>
                    <div className="text-slate-600 text-[9px]">{[lead.geo_state, lead.geo_zip].filter(Boolean).join(' ') || ''}</div>
                  </td>
                  <td className="py-2 px-2">
                    {lead.device_type === 'mobile' ? <Smartphone className="w-3.5 h-3.5 text-slate-500" /> :
                     lead.device_type === 'tablet' ? <Tablet className="w-3.5 h-3.5 text-slate-500" /> :
                     <Monitor className="w-3.5 h-3.5 text-slate-500" />}
                  </td>
                  <td className="py-2 px-2">
                    {lead.match_score ? (
                      <span className={cn('text-[10px] font-semibold',
                        lead.match_score >= 80 ? 'text-emerald-400' : lead.match_score >= 60 ? 'text-novalyte-400' : 'text-amber-400'
                      )}>{lead.match_score}%</span>
                    ) : '—'}
                  </td>
                  <td className="py-2 px-2 text-slate-500">{new Date(lead.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {leads.length === 0 && <p className="text-center text-slate-500 py-8">No leads yet. Run Google Ads campaigns to intel-landing.</p>}
        </div>
      </div>
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

/* ─── Interactive Traffic Map ─── */

function TrafficMap({ locations, apiKey }: { locations: GeoLocation[]; apiKey: string }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (!mapRef.current || !apiKey) return;
    let cancelled = false;

    const initMap = async () => {
      try {
        // Load Google Maps JS API
        if (!(window as any).google?.maps) {
          await new Promise<void>((resolve, reject) => {
            // Check if script already loading
            if (document.querySelector('script[src*="maps.googleapis.com"]')) {
              const check = setInterval(() => {
                if ((window as any).google?.maps) { clearInterval(check); resolve(); }
              }, 100);
              setTimeout(() => { clearInterval(check); reject(new Error('Maps load timeout')); }, 10000);
              return;
            }
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly`;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Google Maps'));
            document.head.appendChild(script);
          });
        }

        if (cancelled || !mapRef.current) return;
        const gm = (window as any).google.maps;

        // Dark style
        const darkStyle = [
          { elementType: 'geometry', stylers: [{ color: '#0a0a0f' }] },
          { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0f' }] },
          { elementType: 'labels.text.fill', stylers: [{ color: '#3a3f4b' }] },
          { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#1a1a2e' }] },
          { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a3e' }] },
          { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#1a1a2e' }] },
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'road', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
          { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#070d15' }] },
          { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
          { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0d0d14' }] },
        ];

        // Create or reuse map
        if (!mapInstanceRef.current) {
          mapInstanceRef.current = new gm.Map(mapRef.current, {
            center: { lat: 39.0, lng: -98.0 },
            zoom: 4,
            styles: darkStyle,
            disableDefaultUI: true,
            zoomControl: true,
            backgroundColor: '#0a0a0f',
            gestureHandling: 'cooperative',
          });
        }

        const map = mapInstanceRef.current;

        // Clear old markers
        markersRef.current.forEach(m => m.setMap(null));
        markersRef.current = [];

        // Max visitors for scaling
        const maxVisitors = Math.max(...locations.map(l => l.visitors), 1);

        // Add markers with rich tooltips
        locations.forEach(loc => {
          const scale = Math.max(6, Math.min(20, 6 + (loc.visitors / maxVisitors) * 14));
          const opacity = Math.max(0.5, Math.min(1, 0.5 + (loc.visitors / maxVisitors) * 0.5));

          const marker = new gm.Marker({
            position: { lat: loc.lat, lng: loc.lng },
            map,
            icon: {
              path: gm.SymbolPath.CIRCLE,
              fillColor: loc.leads > 0 ? '#06B6D4' : '#22D3EE',
              fillOpacity: opacity,
              strokeColor: '#06B6D4',
              strokeWeight: loc.leads > 0 ? 2 : 1,
              scale,
            },
            title: `${loc.city}${loc.state ? ', ' + loc.state : ''}`,
            zIndex: loc.visitors,
          });

          // Rich tooltip on hover
          const infoContent = `
            <div style="font-family:Inter,system-ui,sans-serif;padding:8px 4px;min-width:180px;color:#1a1a2e;">
              <div style="font-size:13px;font-weight:700;margin-bottom:6px;color:#0a0a0f;">
                📍 ${loc.city}${loc.state ? ', ' + loc.state : ''}
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:11px;">
                <div style="color:#666;">Visitors</div>
                <div style="font-weight:600;color:#0891B2;">${loc.visitors}</div>
                <div style="color:#666;">Leads</div>
                <div style="font-weight:600;color:${loc.leads > 0 ? '#059669' : '#666'};">${loc.leads}</div>
                <div style="color:#666;">Sessions</div>
                <div style="font-weight:600;color:#0a0a0f;">${loc.sessions}</div>
                <div style="color:#666;">Device</div>
                <div style="font-weight:500;color:#0a0a0f;text-transform:capitalize;">${loc.topDevice}</div>
                <div style="color:#666;">Source</div>
                <div style="font-weight:500;color:#0a0a0f;">${loc.topSource}</div>
                ${loc.topTreatment ? `<div style="color:#666;">Treatment</div><div style="font-weight:500;color:#0a0a0f;text-transform:capitalize;">${loc.topTreatment}</div>` : ''}
              </div>
              <div style="margin-top:6px;font-size:9px;color:#999;">
                Last activity: ${formatTimeAgo(loc.lastActivity)}
              </div>
            </div>
          `;

          const infoWindow = new gm.InfoWindow({ content: infoContent, maxWidth: 250 });

          marker.addListener('mouseover', () => infoWindow.open(map, marker));
          marker.addListener('mouseout', () => infoWindow.close());
          marker.addListener('click', () => {
            map.panTo(marker.getPosition());
            map.setZoom(Math.min(map.getZoom() + 2, 12));
          });

          markersRef.current.push(marker);
        });

        setMapLoaded(true);
      } catch (err) {
        console.error('Map init error:', err);
        if (!cancelled) setMapError(err instanceof Error ? err.message : 'Map failed to load');
      }
    };

    initMap();
    return () => { cancelled = true; };
  }, [apiKey, locations]);

  return (
    <div className="relative">
      <div ref={mapRef} className="rounded-lg border border-white/[0.06] h-[380px]" style={{ backgroundColor: '#0a0a0f' }} />
      {!mapLoaded && !mapError && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg" style={{ backgroundColor: '#0a0a0f' }}>
          <div className="text-center">
            <RefreshCw className="w-5 h-5 text-novalyte-400 animate-spin mx-auto mb-2" />
            <p className="text-[10px] text-slate-500">Loading map...</p>
          </div>
        </div>
      )}
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg" style={{ backgroundColor: '#0a0a0f' }}>
          <div className="text-center">
            <MapPin className="w-6 h-6 text-red-400 mx-auto mb-2" />
            <p className="text-xs text-red-400">{mapError}</p>
          </div>
        </div>
      )}
      {mapLoaded && locations.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg pointer-events-none">
          <div className="text-center bg-black/40 px-4 py-3 rounded-lg">
            <Globe className="w-8 h-8 text-slate-700 mx-auto mb-2" />
            <p className="text-xs text-slate-500">Awaiting traffic data</p>
            <p className="text-[10px] text-slate-600 mt-1">Markers appear as visitors arrive with geo data</p>
          </div>
        </div>
      )}
      {/* Legend */}
      {mapLoaded && locations.length > 0 && (
        <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/[0.06]">
          <div className="flex items-center gap-3 text-[9px] text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> With leads</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-300/50 inline-block" /> Visitors only</span>
            <span>Larger = more traffic</span>
          </div>
        </div>
      )}
    </div>
  );
}
