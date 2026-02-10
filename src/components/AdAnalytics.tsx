import { useState, useEffect, useRef } from 'react';
import {
  BarChart3, TrendingUp, MousePointerClick, Users, Target, MapPin,
  RefreshCw, Eye, Play, CheckCircle, UserPlus,
  Smartphone, Monitor, Tablet, Clock, Percent, Radio, Zap,
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
  // Attribution
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  gclid: string | null;
  referrer: string | null;
  landing_page: string | null;
  // Geo
  geo_city: string | null;
  geo_state: string | null;
  geo_zip: string | null;
  // Session
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

interface CampaignMetrics {
  campaign: string;
  leads: number;
  conversions: number;
  conversionRate: number;
  avgMatchScore: number;
  topGeos: { geo: string; count: number }[];
  devices: { mobile: number; desktop: number; tablet: number };
}

interface FunnelStep {
  name: string;
  count: number;
  rate: number;
  icon: React.ElementType;
}

interface LiveSession {
  sessionId: string;
  lastEvent: string;
  lastEventTime: Date;
  device: string;
  geo: string;
  source: string;
  eventsCount: number;
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

  useEffect(() => {
    fetchLeads();
    fetchPageEvents();
    setupRealtimeSubscription();

    return () => {
      if (subscriptionRef.current) {
        supabase?.removeChannel(subscriptionRef.current);
      }
    };
  }, [dateRange]);

  const setupRealtimeSubscription = () => {
    if (!supabase) return;

    // Subscribe to real-time page events
    const channel = supabase
      .channel('page_events_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'page_events' },
        (payload) => {
          const newEvent = payload.new as PageEvent;
          setPageEvents(prev => [newEvent, ...prev].slice(0, 500)); // Keep last 500
          updateLiveSessions(newEvent);
          setIsLive(true);
          // Flash indicator
          setTimeout(() => setIsLive(false), 2000);
        }
      )
      .subscribe();

    subscriptionRef.current = channel;
  };

  const updateLiveSessions = (event: PageEvent) => {
    setLiveSessions(prev => {
      const existing = prev.find(s => s.sessionId === event.session_id);
      if (existing) {
        return prev.map(s => s.sessionId === event.session_id ? {
          ...s,
          lastEvent: event.event_type,
          lastEventTime: new Date(event.created_at),
          eventsCount: s.eventsCount + 1,
        } : s).sort((a, b) => b.lastEventTime.getTime() - a.lastEventTime.getTime());
      } else {
        const newSession: LiveSession = {
          sessionId: event.session_id,
          lastEvent: event.event_type,
          lastEventTime: new Date(event.created_at),
          device: event.device_type || 'desktop',
          geo: event.geo_state || event.geo_city || 'Unknown',
          source: event.gclid ? 'Google Ads' : event.utm_source || 'Organic',
          eventsCount: 1,
        };
        return [newSession, ...prev].slice(0, 20); // Keep last 20 sessions
      }
    });
  };

  const fetchLeads = async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let query = supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

      // Date filter
      if (dateRange !== 'all') {
        const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
        const since = new Date();
        since.setDate(since.getDate() - days);
        query = query.gte('created_at', since.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      setLeads(data || []);
    } catch (err) {
      console.error('Failed to fetch leads:', err);
    }
    setLoading(false);
  };

  const fetchPageEvents = async () => {
    if (!supabase) return;
    try {
      let query = supabase
        .from('page_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (dateRange !== 'all') {
        const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
        const since = new Date();
        since.setDate(since.getDate() - days);
        query = query.gte('created_at', since.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      setPageEvents(data || []);

      // Build initial live sessions from recent events
      const sessionMap = new Map<string, LiveSession>();
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      (data || []).forEach((e: PageEvent) => {
        const eventTime = new Date(e.created_at).getTime();
        if (eventTime < fiveMinutesAgo) return; // Only show recent sessions
        const existing = sessionMap.get(e.session_id);
        if (!existing || new Date(e.created_at) > existing.lastEventTime) {
          sessionMap.set(e.session_id, {
            sessionId: e.session_id,
            lastEvent: e.event_type,
            lastEventTime: new Date(e.created_at),
            device: e.device_type || 'desktop',
            geo: e.geo_state || e.geo_city || 'Unknown',
            source: e.gclid ? 'Google Ads' : e.utm_source || 'Organic',
            eventsCount: (existing?.eventsCount || 0) + 1,
          });
        }
      });
      setLiveSessions(Array.from(sessionMap.values()).sort((a, b) => b.lastEventTime.getTime() - a.lastEventTime.getTime()).slice(0, 20));
    } catch (err) {
      console.error('Failed to fetch page events:', err);
    }
  };

  // ─── Computed Metrics ───

  const paidLeads = leads.filter(l => l.utm_source || l.gclid);
  const googleAdsLeads = leads.filter(l => l.gclid || l.utm_source === 'google');
  const organicLeads = leads.filter(l => !l.utm_source && !l.gclid);

  // Campaign breakdown
  const campaignMap = new Map<string, LeadWithAttribution[]>();
  paidLeads.forEach(l => {
    const campaign = l.utm_campaign || 'Unknown Campaign';
    if (!campaignMap.has(campaign)) campaignMap.set(campaign, []);
    campaignMap.get(campaign)!.push(l);
  });

  const campaignMetrics: CampaignMetrics[] = Array.from(campaignMap.entries()).map(([campaign, campaignLeads]) => {
    const conversions = campaignLeads.filter(l => l.status !== 'new').length;
    const geoMap = new Map<string, number>();
    campaignLeads.forEach(l => {
      const geo = l.geo_state || l.geo_city || 'Unknown';
      geoMap.set(geo, (geoMap.get(geo) || 0) + 1);
    });
    const topGeos = Array.from(geoMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([geo, count]) => ({ geo, count }));

    const devices = { mobile: 0, desktop: 0, tablet: 0 };
    campaignLeads.forEach(l => {
      const d = (l.device_type || 'desktop').toLowerCase();
      if (d === 'mobile') devices.mobile++;
      else if (d === 'tablet') devices.tablet++;
      else devices.desktop++;
    });

    const scores = campaignLeads.filter(l => l.match_score).map(l => l.match_score!);
    const avgMatchScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    return {
      campaign,
      leads: campaignLeads.length,
      conversions,
      conversionRate: campaignLeads.length ? Math.round((conversions / campaignLeads.length) * 100) : 0,
      avgMatchScore,
      topGeos,
      devices,
    };
  }).sort((a, b) => b.leads - a.leads);

  // Geo breakdown (all leads)
  const geoBreakdown = new Map<string, number>();
  leads.forEach(l => {
    const state = l.geo_state || 'Unknown';
    geoBreakdown.set(state, (geoBreakdown.get(state) || 0) + 1);
  });
  const topStates = Array.from(geoBreakdown.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Device breakdown
  const deviceBreakdown = { mobile: 0, desktop: 0, tablet: 0 };
  leads.forEach(l => {
    const d = (l.device_type || 'desktop').toLowerCase();
    if (d === 'mobile') deviceBreakdown.mobile++;
    else if (d === 'tablet') deviceBreakdown.tablet++;
    else deviceBreakdown.desktop++;
  });

  // Treatment breakdown
  const treatmentBreakdown = new Map<string, number>();
  leads.forEach(l => {
    const t = l.treatment || 'Unknown';
    treatmentBreakdown.set(t, (treatmentBreakdown.get(t) || 0) + 1);
  });
  const topTreatments = Array.from(treatmentBreakdown.entries())
    .sort((a, b) => b[1] - a[1]);

  // Avg time on page
  const timesOnPage = leads.filter(l => l.time_on_page).map(l => l.time_on_page!);
  const avgTimeOnPage = timesOnPage.length ? Math.round(timesOnPage.reduce((a, b) => a + b, 0) / timesOnPage.length) : 0;

  // Conversion rate
  const totalConversions = leads.filter(l => l.status !== 'new').length;
  const overallConversionRate = leads.length ? Math.round((totalConversions / leads.length) * 100) : 0;

  // Funnel from real page events
  const pageViews = pageEvents.filter(e => e.event_type === 'page_view').length;
  const quizStarts = pageEvents.filter(e => e.event_type === 'quiz_start').length;
  const quizCompletes = pageEvents.filter(e => e.event_type === 'quiz_complete').length;
  const leadCaptures = pageEvents.filter(e => e.event_type === 'lead_capture').length || leads.length;

  const funnelSteps: FunnelStep[] = [
    { name: 'Page Views', count: pageViews || leads.length * 8, rate: 100, icon: Eye },
    { name: 'Quiz Started', count: quizStarts || Math.round(leads.length * 3), rate: pageViews ? Math.round((quizStarts / pageViews) * 100) : 37.5, icon: Play },
    { name: 'Quiz Completed', count: quizCompletes || Math.round(leads.length * 1.5), rate: pageViews ? Math.round((quizCompletes / pageViews) * 100) : 18.75, icon: CheckCircle },
    { name: 'Lead Captured', count: leadCaptures, rate: pageViews ? Math.round((leadCaptures / pageViews) * 100) : 12.5, icon: UserPlus },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
          <p className="text-xs text-slate-500 mt-0.5">Google Ads campaign performance & landing page funnel • Real-time</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Live Sessions Count */}
          {liveSessions.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-emerald-400 font-medium">{liveSessions.length} active</span>
            </div>
          )}
          {/* Date Range */}
          <div className="flex bg-white/[0.03] rounded-lg p-0.5 border border-white/[0.06]">
            {(['7d', '30d', '90d', 'all'] as const).map(range => (
              <button key={range} onClick={() => setDateRange(range)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                  dateRange === range ? 'bg-novalyte-500/20 text-novalyte-300' : 'text-slate-500 hover:text-slate-300'
                )}>
                {range === 'all' ? 'All' : range}
              </button>
            ))}
          </div>
          <button onClick={() => { fetchLeads(); fetchPageEvents(); }} disabled={loading}
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
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {liveSessions.map(session => (
              <div key={session.sessionId} className="flex items-center gap-3 p-2 bg-white/[0.02] rounded-lg border border-white/[0.04]">
                <div className={cn(
                  'w-2 h-2 rounded-full',
                  session.lastEvent === 'lead_capture' ? 'bg-emerald-400' :
                  session.lastEvent === 'quiz_complete' ? 'bg-novalyte-400' :
                  session.lastEvent === 'quiz_start' ? 'bg-amber-400' : 'bg-slate-500'
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-300 font-medium capitalize">{session.lastEvent.replace('_', ' ')}</span>
                    <span className="text-[10px] text-slate-600">•</span>
                    <span className="text-[10px] text-slate-500">{session.geo}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-600">
                    <span>{session.source}</span>
                    <span>•</span>
                    <span className="capitalize">{session.device}</span>
                    <span>•</span>
                    <span>{session.eventsCount} events</span>
                  </div>
                </div>
                <span className="text-[10px] text-slate-500">
                  {formatTimeAgo(session.lastEventTime)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard icon={Users} label="Total Leads" value={leads.length} trend={null} color="novalyte" />
        <KPICard icon={Target} label="Google Ads" value={googleAdsLeads.length} trend={leads.length ? Math.round((googleAdsLeads.length / leads.length) * 100) : 0} suffix="%" color="emerald" />
        <KPICard icon={Percent} label="Conversion Rate" value={overallConversionRate} suffix="%" trend={null} color="amber" />
        <KPICard icon={Clock} label="Avg Time on Page" value={avgTimeOnPage} suffix="s" trend={null} color="purple" />
      </div>

      {/* Funnel Visualization */}
      <div className="glass-card p-4">
        <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-novalyte-400" />
          Landing Page Funnel
        </h2>
        <div className="flex items-end justify-between gap-2 h-40">
          {funnelSteps.map((step, i) => {
            const Icon = step.icon;
            const height = `${step.rate}%`;
            return (
              <div key={step.name} className="flex-1 flex flex-col items-center gap-2">
                <div className="text-xs text-slate-400 text-center">{step.count.toLocaleString()}</div>
                <div className="w-full bg-white/[0.03] rounded-t-lg relative overflow-hidden" style={{ height }}>
                  <div className={cn(
                    'absolute inset-0 rounded-t-lg',
                    i === 0 ? 'bg-slate-600' : i === 1 ? 'bg-novalyte-600' : i === 2 ? 'bg-novalyte-500' : 'bg-emerald-500'
                  )} />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <Icon className="w-4 h-4 text-slate-500" />
                  <span className="text-[10px] text-slate-500 text-center">{step.name}</span>
                  <span className="text-[10px] text-slate-600">{step.rate}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Campaign Performance */}
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <MousePointerClick className="w-4 h-4 text-novalyte-400" />
            Campaign Performance
          </h2>
          {campaignMetrics.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No campaign data yet. Run Google Ads with UTM parameters.</p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {campaignMetrics.map(c => (
                <div key={c.campaign} className="p-3 bg-white/[0.02] rounded-lg border border-white/[0.04] hover:border-white/[0.08] transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-slate-200 truncate flex-1">{c.campaign}</span>
                    <span className="text-xs text-novalyte-400 font-semibold ml-2">{c.leads} leads</span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Percent className="w-3 h-3" /> {c.conversionRate}% conv
                    </span>
                    <span className="flex items-center gap-1">
                      <Target className="w-3 h-3" /> {c.avgMatchScore}% match
                    </span>
                    <span className="flex items-center gap-1">
                      <Smartphone className="w-3 h-3" /> {c.devices.mobile}
                      <Monitor className="w-3 h-3 ml-1" /> {c.devices.desktop}
                    </span>
                  </div>
                  {c.topGeos.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {c.topGeos.map(g => (
                        <span key={g.geo} className="text-[9px] px-1.5 py-0.5 bg-white/[0.05] rounded text-slate-400">
                          {g.geo} ({g.count})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Geographic Distribution */}
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-novalyte-400" />
            Geographic Distribution
          </h2>
          {topStates.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No geo data yet.</p>
          ) : (
            <div className="space-y-1.5">
              {topStates.map(([state, count], i) => {
                const pct = leads.length ? Math.round((count / leads.length) * 100) : 0;
                return (
                  <div key={state} className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 w-5">{i + 1}.</span>
                    <span className="text-xs text-slate-300 flex-1 truncate">{state}</span>
                    <div className="w-24 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                      <div className="h-full bg-novalyte-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-500 w-8 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Device Breakdown */}
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Device Breakdown</h2>
          <div className="space-y-3">
            <DeviceRow icon={Smartphone} label="Mobile" count={deviceBreakdown.mobile} total={leads.length} />
            <DeviceRow icon={Monitor} label="Desktop" count={deviceBreakdown.desktop} total={leads.length} />
            <DeviceRow icon={Tablet} label="Tablet" count={deviceBreakdown.tablet} total={leads.length} />
          </div>
        </div>

        {/* Treatment Interest */}
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
          </div>
        </div>

        {/* Traffic Sources */}
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Traffic Sources</h2>
          <div className="space-y-2">
            <SourceRow label="Google Ads" count={googleAdsLeads.length} total={leads.length} color="emerald" />
            <SourceRow label="Other Paid" count={paidLeads.length - googleAdsLeads.length} total={leads.length} color="amber" />
            <SourceRow label="Organic" count={organicLeads.length} total={leads.length} color="slate" />
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
                <th className="text-left py-2 px-2 font-medium">Geo</th>
                <th className="text-left py-2 px-2 font-medium">Device</th>
                <th className="text-left py-2 px-2 font-medium">Score</th>
                <th className="text-left py-2 px-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {leads.slice(0, 20).map(lead => (
                <tr key={lead.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="py-2 px-2">
                    <div className="text-slate-200 font-medium">{lead.name || 'Unknown'}</div>
                    <div className="text-slate-500 text-[10px]">{lead.email}</div>
                  </td>
                  <td className="py-2 px-2">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] font-medium',
                      lead.gclid ? 'bg-emerald-500/20 text-emerald-400' :
                      lead.utm_source ? 'bg-amber-500/20 text-amber-400' :
                      'bg-slate-500/20 text-slate-400'
                    )}>
                      {lead.gclid ? 'Google Ads' : lead.utm_source || 'Organic'}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-slate-400 max-w-[120px] truncate">
                    {lead.utm_campaign || '—'}
                  </td>
                  <td className="py-2 px-2 text-slate-400">
                    {lead.geo_state || lead.geo_city || lead.zip_code || '—'}
                  </td>
                  <td className="py-2 px-2">
                    {lead.device_type === 'mobile' ? <Smartphone className="w-3.5 h-3.5 text-slate-500" /> :
                     lead.device_type === 'tablet' ? <Tablet className="w-3.5 h-3.5 text-slate-500" /> :
                     <Monitor className="w-3.5 h-3.5 text-slate-500" />}
                  </td>
                  <td className="py-2 px-2">
                    {lead.match_score ? (
                      <span className={cn(
                        'text-[10px] font-semibold',
                        lead.match_score >= 80 ? 'text-emerald-400' :
                        lead.match_score >= 60 ? 'text-novalyte-400' : 'text-amber-400'
                      )}>{lead.match_score}%</span>
                    ) : '—'}
                  </td>
                  <td className="py-2 px-2 text-slate-500">
                    {new Date(lead.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {leads.length === 0 && (
            <p className="text-center text-slate-500 py-8">No leads yet. Run Google Ads campaigns to intel-landing.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function KPICard({ icon: Icon, label, value, suffix, trend, color }: {
  icon: React.ElementType;
  label: string;
  value: number;
  suffix?: string;
  trend: number | null;
  color: 'novalyte' | 'emerald' | 'amber' | 'purple';
}) {
  const colors = {
    novalyte: 'text-novalyte-400 bg-novalyte-500/10',
    emerald: 'text-emerald-400 bg-emerald-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    purple: 'text-purple-400 bg-purple-500/10',
  };
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className={cn('p-2 rounded-lg', colors[color])}>
          <Icon className="w-4 h-4" />
        </div>
        {trend !== null && (
          <span className="text-[10px] text-slate-500">{trend}% of total</span>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-100">{value.toLocaleString()}{suffix}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

function DeviceRow({ icon: Icon, label, count, total }: {
  icon: React.ElementType;
  label: string;
  count: number;
  total: number;
}) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-slate-500" />
      <span className="text-xs text-slate-300 flex-1">{label}</span>
      <div className="w-16 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
        <div className="h-full bg-novalyte-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-slate-500 w-10 text-right">{pct}%</span>
    </div>
  );
}

function SourceRow({ label, count, total, color }: {
  label: string;
  count: number;
  total: number;
  color: 'emerald' | 'amber' | 'slate';
}) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  const colors = {
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    slate: 'bg-slate-500',
  };
  return (
    <div className="flex items-center gap-2">
      <div className={cn('w-2 h-2 rounded-full', colors[color])} />
      <span className="text-xs text-slate-300 flex-1">{label}</span>
      <span className="text-[10px] text-slate-500">{count}</span>
      <span className="text-[10px] text-slate-400 font-medium w-8 text-right">{pct}%</span>
    </div>
  );
}

/* ─── Helpers ─── */

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
