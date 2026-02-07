import { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, Building2, Users, Phone, Target, ArrowUpRight,
  Zap, Brain, Activity, MapPin, Sparkles, AlertTriangle,
  ChevronRight, RefreshCw, Radar, Mail, Clock,
  ArrowDownRight, CheckCircle2, DollarSign, BarChart3,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { aiInsightsService, AIInsight, PipelineHealth, MarketOpportunity } from '../services/aiInsightsService';
import { generateRevenueForecast, RevenueForecast } from '../services/intelligenceService';
import { cn } from '../utils/cn';

function Dashboard() {
  const { contacts, clinics, keywordTrends, markets, callHistory, sentEmails, setCurrentView } = useAppStore();
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [pipelineHealth, setPipelineHealth] = useState<PipelineHealth | null>(null);
  const [marketOpps, setMarketOpps] = useState<MarketOpportunity[]>([]);
  const [forecast, setForecast] = useState<RevenueForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  useEffect(() => {
    setPipelineHealth(aiInsightsService.computePipelineHealth(contacts));
    setMarketOpps(aiInsightsService.computeMarketOpportunities(markets, clinics, contacts, keywordTrends));
  }, [contacts, clinics, keywordTrends, markets]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoadingInsights(true);
      try { const r = await aiInsightsService.generateInsights(contacts, clinics, keywordTrends, markets); if (!cancelled) setInsights(r); } catch {}
      if (!cancelled) setIsLoadingInsights(false);
    })();
    return () => { cancelled = true; };
  }, [contacts, clinics, keywordTrends, markets]);

  // Revenue forecast — computed from real lead economics (sync, no API call)
  useEffect(() => {
    if (contacts.length === 0) { setForecast(null); return; }
    setForecastLoading(true);
    try {
      const callData = callHistory.map(c => ({ contactId: c.contactId, outcome: c.outcome }));
      const result = generateRevenueForecast(contacts, sentEmails, callData);
      setForecast(result);
    } catch (err) { console.warn('Forecast error:', err); }
    setForecastLoading(false);
  }, [contacts.length, sentEmails.length, callHistory.length]);

  const stats = useMemo(() => {
    const qualified = contacts.filter(c => c.status === 'qualified').length;
    const withEmail = contacts.filter(c => c.decisionMaker?.email).length;
    const readyToCall = contacts.filter(c => c.status === 'ready_to_call').length;
    const overdue = contacts.filter(c => c.nextFollowUp && new Date(c.nextFollowUp) < new Date()).length;
    const avgScore = contacts.length > 0 ? Math.round(contacts.reduce((s, c) => s + c.score, 0) / contacts.length) : 0;
    const regions = new Set(contacts.map(c => `${c.clinic.address.city}, ${c.clinic.address.state}`)).size;
    return { qualified, withEmail, readyToCall, overdue, avgScore, regions };
  }, [contacts]);

  const refreshInsights = async () => {
    aiInsightsService.invalidateCache();
    setIsLoadingInsights(true);
    try { setInsights(await aiInsightsService.generateInsights(contacts, clinics, keywordTrends, markets)); } catch {}
    setIsLoadingInsights(false);
  };

  const insightIcon = (type: AIInsight['type']) => {
    const map = { opportunity: <Zap className="w-4 h-4 text-emerald-400" />, risk: <AlertTriangle className="w-4 h-4 text-red-400" />, action: <Target className="w-4 h-4 text-amber-400" />, trend: <TrendingUp className="w-4 h-4 text-novalyte-400" />, forecast: <Brain className="w-4 h-4 text-purple-400" /> };
    return map[type];
  };

  const severityBorder = (s: AIInsight['severity']) => {
    const map = { critical: 'border-l-red-500', high: 'border-l-orange-500', medium: 'border-l-amber-500', low: 'border-l-slate-600' };
    return map[s];
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">

      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">Command Center</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-gradient-to-r from-novalyte-500 to-accent-500 text-white shadow-lg shadow-novalyte-500/20">
              <Brain className="w-3 h-3" /> AI-Powered
            </span>
          </div>
          <p className="text-sm text-slate-500">Real-time pipeline analytics and AI-driven intelligence</p>
        </div>
        <button onClick={refreshInsights} disabled={isLoadingInsights}
          className="btn btn-secondary text-xs">
          <RefreshCw className={cn('w-3.5 h-3.5 mr-2', isLoadingInsights && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Pipeline Health + Metrics */}
      <div className="grid grid-cols-12 gap-4">
        {/* Pipeline Health */}
        <div className="col-span-12 lg:col-span-4 glass-card p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-novalyte-500/8 to-transparent rounded-bl-full pointer-events-none" />
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-novalyte-400" />
            <h3 className="text-sm font-semibold text-slate-300">Pipeline Health</h3>
          </div>
          {pipelineHealth && (
            <div className="space-y-4">
              <div className="flex items-end gap-3">
                <span className={cn('text-4xl font-bold tabular-nums',
                  pipelineHealth.score >= 70 ? 'text-emerald-400' : pipelineHealth.score >= 40 ? 'text-amber-400' : 'text-red-400'
                )}>{pipelineHealth.score}</span>
                <span className="text-sm text-slate-600 mb-1">/100</span>
                <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold mb-1',
                  pipelineHealth.trend === 'improving' ? 'bg-emerald-500/15 text-emerald-400' :
                  pipelineHealth.trend === 'stable' ? 'bg-slate-500/15 text-slate-400' :
                  'bg-red-500/15 text-red-400'
                )}>
                  {pipelineHealth.trend === 'improving' ? <ArrowUpRight className="w-3 h-3" /> :
                   pipelineHealth.trend === 'declining' ? <ArrowDownRight className="w-3 h-3" /> : null}
                  {pipelineHealth.trend}
                </span>
              </div>
              <div className="w-full bg-white/5 rounded-full h-2">
                <div className={cn('h-2 rounded-full transition-all duration-700',
                  pipelineHealth.score >= 70 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' :
                  pipelineHealth.score >= 40 ? 'bg-gradient-to-r from-amber-500 to-amber-400' :
                  'bg-gradient-to-r from-red-500 to-red-400'
                )} style={{ width: `${pipelineHealth.score}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 bg-white/[0.03] rounded-lg border border-white/[0.04]">
                  <p className="text-slate-500 text-[10px]">Conversion</p>
                  <p className="font-bold text-slate-200">{pipelineHealth.conversionRate}%</p>
                </div>
                <div className="p-2.5 bg-white/[0.03] rounded-lg border border-white/[0.04]">
                  <p className="text-slate-500 text-[10px]">Velocity</p>
                  <p className="font-bold text-slate-200">{pipelineHealth.velocity}d avg</p>
                </div>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{pipelineHealth.recommendation}</p>
            </div>
          )}
        </div>

        {/* Metric tiles */}
        <div className="col-span-12 lg:col-span-8 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'CRM Accounts', value: contacts.length, icon: Users, gradient: 'from-novalyte-500 to-novalyte-600', view: 'crm' as const },
            { label: 'Clinics Found', value: clinics.length, icon: Building2, gradient: 'from-blue-500 to-blue-600', view: 'clinics' as const },
            { label: 'With Email', value: stats.withEmail, icon: Mail, gradient: 'from-emerald-500 to-emerald-600', view: 'crm' as const },
            { label: 'Qualified', value: stats.qualified, icon: CheckCircle2, gradient: 'from-green-500 to-green-600', view: 'crm' as const },
            { label: 'Ready to Call', value: stats.readyToCall, icon: Phone, gradient: 'from-violet-500 to-violet-600', view: 'voice' as const },
            { label: 'Avg Score', value: stats.avgScore, icon: Target, gradient: 'from-amber-500 to-amber-600', view: 'crm' as const },
            { label: 'Regions', value: stats.regions, icon: MapPin, gradient: 'from-rose-500 to-rose-600', view: 'clinics' as const },
            { label: 'Overdue', value: stats.overdue, icon: Clock, gradient: stats.overdue > 0 ? 'from-red-500 to-red-600' : 'from-slate-600 to-slate-700', view: 'crm' as const },
          ].map(s => {
            const Icon = s.icon;
            return (
              <button key={s.label} onClick={() => setCurrentView(s.view)}
                className="glass-card p-4 text-left hover:bg-white/[0.04] transition-all group">
                <div className="flex items-center justify-between mb-3">
                  <div className={cn('w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center shadow-lg', s.gradient)}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-700 group-hover:text-slate-500 transition-colors" />
                </div>
                <p className="text-2xl font-bold text-white tabular-nums">{s.value}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{s.label}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* AI Insights + Market Opportunities */}
      <div className="grid grid-cols-12 gap-4">
        {/* AI Insights */}
        <div className="col-span-12 lg:col-span-7 glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-accent-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-200">AI Intelligence Feed</h3>
                <p className="text-[10px] text-slate-600">Powered by Gemini</p>
              </div>
            </div>
            {isLoadingInsights && <RefreshCw className="w-4 h-4 text-slate-600 animate-spin" />}
          </div>
          <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-auto">
            {insights.length > 0 ? insights.map(insight => (
              <div key={insight.id} className={cn('px-5 py-3.5 border-l-[3px] hover:bg-white/[0.02] transition-colors', severityBorder(insight.severity))}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">{insightIcon(insight.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-semibold text-slate-200">{insight.title}</p>
                      {insight.metric && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/5 text-slate-400 tabular-nums">{insight.metric}</span>}
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">{insight.description}</p>
                  </div>
                  {insight.actionLabel && insight.actionTarget && (
                    <button onClick={() => setCurrentView(insight.actionTarget as any)}
                      className="shrink-0 btn btn-primary text-[11px] px-2.5 py-1.5">
                      {insight.actionLabel} <ChevronRight className="w-3 h-3 ml-1" />
                    </button>
                  )}
                </div>
              </div>
            )) : (
              <div className="px-5 py-12 text-center">
                <Brain className="w-10 h-10 text-slate-800 mx-auto mb-3" />
                <p className="text-sm text-slate-600">Add contacts to activate AI intelligence</p>
              </div>
            )}
          </div>
        </div>

        {/* Market Opportunities */}
        <div className="col-span-12 lg:col-span-5 glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Radar className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Market Opportunities</h3>
                <p className="text-[10px] text-slate-600">{marketOpps.length} markets ranked</p>
              </div>
            </div>
            <button onClick={() => setCurrentView('clinics')} className="text-[11px] text-novalyte-400 hover:text-novalyte-300 font-medium">View All</button>
          </div>
          <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-auto">
            {marketOpps.slice(0, 8).map((opp, i) => (
              <div key={opp.market.id} className="px-5 py-3 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3">
                  <span className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold',
                    i < 3 ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20' : 'bg-white/5 text-slate-500'
                  )}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-200">{opp.market.city}, {opp.market.state}</p>
                      <span className="text-[10px] text-slate-600">{opp.market.metropolitanArea}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px]">
                      <span className="text-slate-600">{opp.clinicsDiscovered} found · {opp.clinicsInCRM} in CRM</span>
                      {opp.topKeyword && opp.topGrowth && opp.topGrowth > 0 && (
                        <span className="text-emerald-400 flex items-center gap-0.5"><TrendingUp className="w-2.5 h-2.5" /> {opp.topKeyword} +{opp.topGrowth}%</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn('text-sm font-bold tabular-nums', opp.score >= 80 ? 'text-emerald-400' : opp.score >= 60 ? 'text-amber-400' : 'text-slate-500')}>{opp.score}</div>
                    <div className="text-[9px] text-slate-600">score</div>
                  </div>
                </div>
                <p className="text-[10px] text-slate-600 mt-1 ml-9">{opp.signal}</p>
              </div>
            ))}
            {marketOpps.length === 0 && (
              <div className="px-5 py-12 text-center">
                <MapPin className="w-10 h-10 text-slate-800 mx-auto mb-3" />
                <p className="text-sm text-slate-600">Discover clinics to see market opportunities</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-12 gap-4">
        {/* Recent Pipeline */}
        <div className="col-span-12 lg:col-span-5 glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2"><Users className="w-4 h-4 text-novalyte-400" /><h3 className="text-sm font-semibold text-slate-200">Recent Pipeline</h3></div>
            <button onClick={() => setCurrentView('crm')} className="text-[11px] text-novalyte-400 hover:text-novalyte-300 font-medium">View CRM</button>
          </div>
          <div className="divide-y divide-white/[0.04] max-h-[300px] overflow-auto">
            {contacts.slice(0, 8).map(contact => (
              <div key={contact.id} onClick={() => setCurrentView('crm')}
                className="px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02] cursor-pointer transition-colors">
                <span className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold',
                  contact.priority === 'critical' ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/20' :
                  contact.priority === 'high' ? 'bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/20' :
                  contact.priority === 'medium' ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20' :
                  'bg-white/5 text-slate-500'
                )}>{contact.score}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{contact.clinic.name}</p>
                  <p className="text-[10px] text-slate-600">{contact.clinic.address.city} · {contact.decisionMaker ? `${contact.decisionMaker.firstName} ${contact.decisionMaker.lastName}` : 'No DM'}</p>
                </div>
                <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium',
                  contact.status === 'qualified' ? 'bg-emerald-500/15 text-emerald-400' :
                  contact.status === 'ready_to_call' ? 'bg-green-500/15 text-green-400' :
                  contact.status === 'follow_up' ? 'bg-amber-500/15 text-amber-400' :
                  'bg-white/5 text-slate-500'
                )}>{contact.status.replace(/_/g, ' ')}</span>
              </div>
            ))}
            {contacts.length === 0 && (
              <div className="px-5 py-10 text-center">
                <Users className="w-8 h-8 text-slate-800 mx-auto mb-2" />
                <p className="text-xs text-slate-600">No contacts yet</p>
                <button onClick={() => setCurrentView('clinics')} className="mt-2 text-xs text-novalyte-400 hover:underline">Discover Clinics</button>
              </div>
            )}
          </div>
        </div>

        {/* Trending Keywords */}
        <div className="col-span-12 lg:col-span-4 glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" /><h3 className="text-sm font-semibold text-slate-200">Trending Keywords</h3></div>
            <button onClick={() => setCurrentView('keywords')} className="text-[11px] text-novalyte-400 hover:text-novalyte-300 font-medium">Scanner</button>
          </div>
          <div className="divide-y divide-white/[0.04] max-h-[300px] overflow-auto">
            {keywordTrends.length > 0 ? [...keywordTrends].sort((a, b) => b.growthRate - a.growthRate).slice(0, 8).map(trend => (
              <div key={trend.id} className="px-5 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{trend.keyword}</p>
                  <p className="text-[10px] text-slate-600">{trend.location.city}, {trend.location.state}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="w-16 bg-white/5 rounded-full h-1.5">
                    <div className={cn('h-1.5 rounded-full', trend.trendScore >= 70 ? 'bg-emerald-500' : trend.trendScore >= 40 ? 'bg-amber-500' : 'bg-slate-600')}
                      style={{ width: `${trend.trendScore}%` }} />
                  </div>
                  <span className={cn('text-xs font-bold tabular-nums', trend.growthRate > 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {trend.growthRate > 0 ? '+' : ''}{trend.growthRate}%
                  </span>
                </div>
              </div>
            )) : (
              <div className="px-5 py-10 text-center">
                <TrendingUp className="w-8 h-8 text-slate-800 mx-auto mb-2" />
                <p className="text-xs text-slate-600">No keyword data yet</p>
                <button onClick={() => setCurrentView('keywords')} className="mt-2 text-xs text-novalyte-400 hover:underline">Start Scanning</button>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions + Revenue Forecast */}
        <div className="col-span-12 lg:col-span-3 space-y-3">
          {/* Revenue Forecast Widget */}
          {(forecast || forecastLoading) && (
            <div className="glass-card p-5 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-emerald-500/5 to-transparent rounded-bl-full pointer-events-none" />
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-300">Lead Economics</h3>
                {forecastLoading && <RefreshCw className="w-3 h-3 text-slate-600 animate-spin" />}
              </div>
              {forecast && (
                <div className="space-y-3">
                  {/* Monthly revenue headline */}
                  <div>
                    <p className="text-2xl font-bold text-emerald-400 tabular-nums">${forecast.monthlyRevenue >= 1000 ? (forecast.monthlyRevenue / 1000).toFixed(1) + 'k' : forecast.monthlyRevenue}<span className="text-sm text-slate-500 font-normal">/mo</span></p>
                    <p className="text-[10px] text-slate-500">{forecast.projectedClients} projected clients × {forecast.estimatedLeadsPerClinic} leads/mo</p>
                  </div>

                  {/* Lead pricing */}
                  <div className="p-2.5 bg-emerald-500/10 rounded-lg border border-emerald-500/10">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-emerald-300 font-medium">Avg Lead Price</span>
                      <span className="text-sm font-bold text-emerald-400">${forecast.avgLeadPrice}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-500">Range</span>
                      <span className="text-[10px] text-slate-400">${forecast.leadPriceRange.low} — ${forecast.leadPriceRange.high}</span>
                    </div>
                  </div>

                  {/* Key metrics grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 bg-white/[0.03] rounded-lg border border-white/[0.04]">
                      <p className="text-slate-500 text-[10px]">Annual Pipeline</p>
                      <p className="font-bold text-slate-200">${(forecast.pipelineValue / 1000).toFixed(0)}k</p>
                    </div>
                    <div className="p-2 bg-white/[0.03] rounded-lg border border-white/[0.04]">
                      <p className="text-slate-500 text-[10px]">Close Rate</p>
                      <p className="font-bold text-slate-200">{forecast.conversionRate}%</p>
                    </div>
                    <div className="p-2 bg-white/[0.03] rounded-lg border border-white/[0.04]">
                      <p className="text-slate-500 text-[10px]">Patient LTV</p>
                      <p className="font-bold text-slate-200">${(forecast.avgPatientLTV / 1000).toFixed(1)}k</p>
                    </div>
                    <div className="p-2 bg-white/[0.03] rounded-lg border border-white/[0.04]">
                      <p className="text-slate-500 text-[10px]">Clinic ROI</p>
                      <p className="font-bold text-emerald-400">{forecast.roiForClinic}x</p>
                    </div>
                  </div>

                  {/* Service breakdown — top 3 */}
                  {forecast.serviceBreakdown.length > 0 && (
                    <div className="border-t border-white/[0.04] pt-2">
                      <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">Lead Pricing by Service</p>
                      {forecast.serviceBreakdown.slice(0, 3).map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
                          <span className="text-slate-400 truncate max-w-[120px]">{s.service}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-400 font-medium">${s.avgCPL}/lead</span>
                            <span className="text-slate-600">·</span>
                            <span className="text-slate-500">{s.clinics} clinics</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Insights */}
                  {forecast.insights.length > 0 && (
                    <div className="space-y-1">
                      {forecast.insights.slice(0, 2).map((insight, i) => (
                        <p key={i} className="text-[10px] text-slate-500 leading-relaxed flex items-start gap-1">
                          <BarChart3 className="w-2.5 h-2.5 text-emerald-500 mt-0.5 shrink-0" />
                          {insight}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Top markets */}
                  {forecast.topMarkets.length > 0 && (
                    <div className="border-t border-white/[0.04] pt-2">
                      <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">Top Markets</p>
                      {forecast.topMarkets.slice(0, 3).map((m, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
                          <span className="text-slate-400">{m.market}</span>
                          <span className="text-emerald-400 font-medium">${(m.projected / 1000).toFixed(0)}k/mo</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Confidence */}
                  <div className="flex items-center justify-between text-[10px] pt-1">
                    <span className="text-slate-600">Confidence</span>
                    <span className={cn('font-medium', forecast.confidence >= 60 ? 'text-emerald-400' : forecast.confidence >= 40 ? 'text-amber-400' : 'text-slate-500')}>{forecast.confidence}%</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="glass-card p-5 bg-gradient-to-br from-novalyte-600/20 to-accent-600/10 border-novalyte-500/10 relative overflow-hidden glow-novalyte">
            <div className="absolute top-0 right-0 w-24 h-24 bg-novalyte-400/5 rounded-bl-full pointer-events-none" />
            <Sparkles className="w-5 h-5 mb-3 text-novalyte-400" />
            <h3 className="text-sm font-bold text-white mb-1">AI Intelligence</h3>
            <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
              {contacts.length > 0 ? `Analyzing ${contacts.length} contacts across ${stats.regions} regions` : 'Build your pipeline to activate AI'}
            </p>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Engine Active
            </div>
          </div>
          {[
            { label: 'Scan Keywords', desc: 'Find trending demand', icon: TrendingUp, view: 'keywords' as const, color: 'text-emerald-400 bg-emerald-500/10' },
            { label: 'Discover Clinics', desc: 'Find new prospects', icon: Radar, view: 'clinics' as const, color: 'text-novalyte-400 bg-novalyte-500/10' },
            { label: 'Open Pipeline', desc: 'Manage outreach', icon: Users, view: 'crm' as const, color: 'text-violet-400 bg-violet-500/10' },
            { label: 'Voice Agent', desc: 'AI-powered calls', icon: Phone, view: 'voice' as const, color: 'text-amber-400 bg-amber-500/10' },
          ].map(a => {
            const Icon = a.icon;
            return (
              <button key={a.label} onClick={() => setCurrentView(a.view)}
                className="glass-card p-3.5 w-full flex items-center gap-3 hover:bg-white/[0.04] transition-all text-left group">
                <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', a.color)}><Icon className="w-4 h-4" /></div>
                <div className="flex-1"><p className="text-sm font-medium text-slate-200">{a.label}</p><p className="text-[10px] text-slate-600">{a.desc}</p></div>
                <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-slate-500 transition-colors" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
