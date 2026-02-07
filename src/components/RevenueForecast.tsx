import { useMemo } from 'react';
import {
  DollarSign, TrendingUp, Users, Target, BarChart3, Zap,
  ArrowUpRight, Building2, MapPin, Activity, Sparkles,
  ChevronRight, Heart, Syringe, Pill, Scissors, Droplets,
  ShieldCheck, CircleDot,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { generateRevenueForecast, RevenueForecast } from '../services/intelligenceService';
import { cn } from '../utils/cn';

/* ─── Service icons ─── */
const svcIcons: Record<string, typeof Heart> = {
  'TRT': Syringe, 'Testosterone': Syringe, 'Hormone': Syringe,
  'ED': Heart, 'Erectile': Heart, 'Sexual': Heart,
  'Peptide': Zap, 'GLP-1': Pill, 'Semaglutide': Pill, 'Tirzepatide': Pill,
  'Weight': Pill, 'Hair': Scissors, 'PRP': Droplets,
  'IV': Droplets, 'Anti-Aging': ShieldCheck, 'Aesthetics': ShieldCheck,
  'HGH': Syringe, 'Bioidentical': Syringe,
};
function getServiceIcon(name: string) {
  for (const [key, Icon] of Object.entries(svcIcons)) {
    if (name.includes(key)) return Icon;
  }
  return Activity;
}

/* ─── Color palette for charts ─── */
const CHART_COLORS = [
  'from-emerald-500 to-emerald-600', 'from-blue-500 to-blue-600',
  'from-violet-500 to-violet-600', 'from-amber-500 to-amber-600',
  'from-rose-500 to-rose-600', 'from-cyan-500 to-cyan-600',
  'from-orange-500 to-orange-600', 'from-pink-500 to-pink-600',
];
const TEXT_COLORS = [
  'text-emerald-400', 'text-blue-400', 'text-violet-400', 'text-amber-400',
  'text-rose-400', 'text-cyan-400', 'text-orange-400', 'text-pink-400',
];
const BG_COLORS = [
  'bg-emerald-500/10', 'bg-blue-500/10', 'bg-violet-500/10', 'bg-amber-500/10',
  'bg-rose-500/10', 'bg-cyan-500/10', 'bg-orange-500/10', 'bg-pink-500/10',
];


export default function RevenueForecastPage() {
  const { contacts, sentEmails, callHistory, setCurrentView } = useAppStore();

  const forecast = useMemo<RevenueForecast | null>(() => {
    if (contacts.length === 0) return null;
    const callData = callHistory.map(c => ({ contactId: c.contactId, outcome: c.outcome }));
    return generateRevenueForecast(contacts, sentEmails, callData);
  }, [contacts, sentEmails, callHistory]);

  if (!forecast) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-12">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center mb-6">
          <DollarSign className="w-10 h-10 text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Revenue Forecast</h2>
        <p className="text-sm text-slate-400 mb-6 text-center max-w-md">
          Add clinics to your pipeline to see lead pricing, revenue projections, and ROI analysis based on real men's health clinic economics.
        </p>
        <button onClick={() => setCurrentView('clinics')} className="btn btn-primary gap-2">
          <Building2 className="w-4 h-4" /> Discover Clinics
        </button>
      </div>
    );
  }

  const maxSvcRevenue = Math.max(...forecast.serviceBreakdown.map(s => s.monthlyRevenue), 1);
  const maxMarketRevenue = Math.max(...forecast.topMarkets.map(m => m.projected), 1);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto animate-fade-in">

      {/* ═══ Header ═══ */}
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">Revenue Forecast</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20">
              <DollarSign className="w-3 h-3" /> Lead Economics
            </span>
          </div>
          <p className="text-sm text-slate-500">
            Pre-qualified patient lead pricing based on {forecast.totalClinics} clinics across {forecast.topMarkets.length} markets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
            forecast.confidence >= 60 ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20' :
            forecast.confidence >= 40 ? 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20' :
            'bg-white/5 text-slate-400 ring-1 ring-white/[0.06]'
          )}>
            <Target className="w-3 h-3" /> {forecast.confidence}% confidence
          </div>
        </div>
      </div>

      {/* ═══ Hero Numbers ═══ */}
      <div className="grid grid-cols-12 gap-4">
        {/* Monthly Revenue — big hero card */}
        <div className="col-span-12 lg:col-span-4 glass-card p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-bl from-emerald-500/8 to-transparent rounded-bl-full pointer-events-none" />
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Projected Monthly</p>
              <p className="text-3xl font-bold text-emerald-400 tabular-nums leading-none mt-0.5">
                ${forecast.monthlyRevenue >= 1000 ? (forecast.monthlyRevenue / 1000).toFixed(1) + 'k' : forecast.monthlyRevenue}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-[10px] text-slate-500">Quarterly</p>
              <p className="text-lg font-bold text-slate-200 tabular-nums">${(forecast.quarterlyRevenue / 1000).toFixed(1)}k</p>
            </div>
            <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-[10px] text-slate-500">Annual</p>
              <p className="text-lg font-bold text-slate-200 tabular-nums">${(forecast.annualRevenue / 1000).toFixed(0)}k</p>
            </div>
          </div>
        </div>

        {/* Lead Pricing Card */}
        <div className="col-span-12 sm:col-span-6 lg:col-span-4 glass-card p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-novalyte-500/8 to-transparent rounded-bl-full pointer-events-none" />
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-novalyte-500 to-novalyte-600 flex items-center justify-center shadow-lg shadow-novalyte-500/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Avg Lead Price</p>
              <p className="text-3xl font-bold text-novalyte-400 tabular-nums leading-none mt-0.5">${forecast.avgLeadPrice}</p>
            </div>
          </div>
          {/* Price range bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1.5">
              <span>${forecast.leadPriceRange.low}</span>
              <span>Price Range</span>
              <span>${forecast.leadPriceRange.high}</span>
            </div>
            <div className="relative h-3 bg-white/5 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 bg-gradient-to-r from-emerald-500/40 via-novalyte-500/60 to-orange-500/40 rounded-full"
                style={{ left: '0%', right: '0%' }} />
              {/* Avg marker */}
              <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg border-2 border-novalyte-400"
                style={{ left: `${Math.min(95, Math.max(5, ((forecast.avgLeadPrice - forecast.leadPriceRange.low) / (forecast.leadPriceRange.high - forecast.leadPriceRange.low)) * 100))}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-[10px] text-slate-500">Leads/Client/Mo</p>
              <p className="text-lg font-bold text-slate-200 tabular-nums">{forecast.estimatedLeadsPerClinic}</p>
            </div>
            <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-[10px] text-slate-500">Rev/Client/Mo</p>
              <p className="text-lg font-bold text-slate-200 tabular-nums">${(forecast.estimatedLeadsPerClinic * forecast.avgLeadPrice).toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* Clinic ROI Card */}
        <div className="col-span-12 sm:col-span-6 lg:col-span-4 glass-card p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-violet-500/8 to-transparent rounded-bl-full pointer-events-none" />
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Clinic ROI</p>
              <p className="text-3xl font-bold text-violet-400 tabular-nums leading-none mt-0.5">{forecast.roiForClinic}x</p>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed mb-4">
            For every $1 a clinic spends on leads, they generate ${forecast.roiForClinic.toFixed(2)} in patient lifetime value
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-[10px] text-slate-500">Patient LTV</p>
              <p className="text-lg font-bold text-slate-200 tabular-nums">${(forecast.avgPatientLTV / 1000).toFixed(1)}k</p>
            </div>
            <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-[10px] text-slate-500">Close Rate</p>
              <p className="text-lg font-bold text-slate-200 tabular-nums">{forecast.avgCloseRate}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Conversion Funnel ═══ */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-5">
          <Activity className="w-4 h-4 text-novalyte-400" />
          <h3 className="text-sm font-semibold text-slate-200">Conversion Funnel</h3>
        </div>
        <div className="flex items-center gap-2">
          {[
            { label: 'Total Clinics', value: forecast.totalClinics, color: 'from-slate-500 to-slate-600', width: 100 },
            { label: 'With Email', value: forecast.clinicsWithEmail, color: 'from-blue-500 to-blue-600', width: forecast.totalClinics ? (forecast.clinicsWithEmail / forecast.totalClinics) * 100 : 0 },
            { label: 'Qualified', value: forecast.qualifiedClinics, color: 'from-amber-500 to-amber-600', width: forecast.totalClinics ? (forecast.qualifiedClinics / forecast.totalClinics) * 100 : 0 },
            { label: 'Projected Clients', value: forecast.projectedClients, color: 'from-emerald-500 to-emerald-600', width: forecast.totalClinics ? (forecast.projectedClients / forecast.totalClinics) * 100 : 0 },
          ].map((step, i, arr) => (
            <div key={step.label} className="flex items-center gap-2 flex-1">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-slate-500">{step.label}</span>
                  <span className="text-sm font-bold text-slate-200 tabular-nums">{step.value}</span>
                </div>
                <div className="h-10 bg-white/5 rounded-lg overflow-hidden relative">
                  <div className={cn('h-full rounded-lg bg-gradient-to-r transition-all duration-700', step.color)}
                    style={{ width: `${Math.max(step.width, 8)}%` }} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[11px] font-bold text-white/80 tabular-nums drop-shadow">
                      {step.value}
                    </span>
                  </div>
                </div>
                {i < arr.length - 1 && step.value > 0 && arr[i + 1].value > 0 && (
                  <p className="text-[9px] text-slate-600 mt-1 text-center">
                    {Math.round((arr[i + 1].value / step.value) * 100)}% →
                  </p>
                )}
              </div>
              {i < arr.length - 1 && (
                <ChevronRight className="w-4 h-4 text-slate-700 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ═══ Service Breakdown + Market Breakdown ═══ */}
      <div className="grid grid-cols-12 gap-4">

        {/* Service Lead Pricing — visual bar chart */}
        <div className="col-span-12 lg:col-span-7 glass-card overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-novalyte-500 to-novalyte-600 flex items-center justify-center shadow-lg shadow-novalyte-500/20">
                <BarChart3 className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Lead Pricing by Service</h3>
                <p className="text-[10px] text-slate-600">{forecast.serviceBreakdown.length} service verticals</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-4">
            {forecast.serviceBreakdown.map((svc, i) => {
              const Icon = getServiceIcon(svc.service);
              const barWidth = (svc.monthlyRevenue / maxSvcRevenue) * 100;
              const color = CHART_COLORS[i % CHART_COLORS.length];
              const textColor = TEXT_COLORS[i % TEXT_COLORS.length];
              const bgColor = BG_COLORS[i % BG_COLORS.length];
              return (
                <div key={svc.service}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', bgColor)}>
                        <Icon className={cn('w-4 h-4', textColor)} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">{svc.service}</p>
                        <p className="text-[10px] text-slate-500">{svc.clinics} clinic{svc.clinics !== 1 ? 's' : ''} · Patient LTV ${(svc.patientLTV / 1000).toFixed(1)}k</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={cn('text-lg font-bold tabular-nums', textColor)}>${svc.avgCPL}</p>
                      <p className="text-[10px] text-slate-500">per lead</p>
                    </div>
                  </div>
                  {/* Revenue bar */}
                  <div className="relative h-7 bg-white/[0.03] rounded-lg overflow-hidden">
                    <div className={cn('h-full rounded-lg bg-gradient-to-r transition-all duration-700', color)}
                      style={{ width: `${Math.max(barWidth, 4)}%` }} />
                    <div className="absolute inset-0 flex items-center px-3">
                      <span className="text-[10px] font-semibold text-white/90 drop-shadow tabular-nums">
                        ${svc.monthlyRevenue.toLocaleString()}/mo × {svc.monthlyLeads} leads
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            {forecast.serviceBreakdown.length === 0 && (
              <div className="text-center py-8">
                <BarChart3 className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-slate-500">No service data — clinics need services tagged</p>
              </div>
            )}
          </div>
        </div>

        {/* Market Revenue — ranked list with bars */}
        <div className="col-span-12 lg:col-span-5 glass-card overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <MapPin className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Revenue by Market</h3>
                <p className="text-[10px] text-slate-600">{forecast.topMarkets.length} markets</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-3">
            {forecast.topMarkets.map((mkt, i) => {
              const barWidth = (mkt.projected / maxMarketRevenue) * 100;
              const textColor = TEXT_COLORS[i % TEXT_COLORS.length];
              const bgColor = BG_COLORS[i % BG_COLORS.length];
              return (
                <div key={mkt.market}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold',
                        i < 3 ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20' : bgColor + ' ' + textColor
                      )}>{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium text-slate-200">{mkt.market}</p>
                        <p className="text-[10px] text-slate-500">{mkt.clinics} clinics · Affluence {mkt.avgAffluence}/10</p>
                      </div>
                    </div>
                    <p className={cn('text-sm font-bold tabular-nums', textColor)}>
                      ${mkt.projected >= 1000 ? (mkt.projected / 1000).toFixed(1) + 'k' : mkt.projected}<span className="text-[10px] text-slate-500 font-normal">/mo</span>
                    </p>
                  </div>
                  <div className="h-2.5 bg-white/[0.03] rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-700',
                      i < 3 ? 'from-emerald-500 to-emerald-400' : 'from-slate-600 to-slate-500'
                    )} style={{ width: `${Math.max(barWidth, 4)}%` }} />
                  </div>
                </div>
              );
            })}
            {forecast.topMarkets.length === 0 && (
              <div className="text-center py-8">
                <MapPin className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-slate-500">No market data yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Pipeline Value + Insights ═══ */}
      <div className="grid grid-cols-12 gap-4">

        {/* Pipeline value breakdown */}
        <div className="col-span-12 lg:col-span-5 glass-card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-200">Pipeline Value</h3>
          </div>

          {/* Big pipeline number */}
          <div className="text-center mb-6">
            <p className="text-4xl font-bold text-emerald-400 tabular-nums">
              ${forecast.pipelineValue >= 1000000
                ? (forecast.pipelineValue / 1000000).toFixed(2) + 'M'
                : (forecast.pipelineValue / 1000).toFixed(0) + 'k'}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">Annual pipeline if all qualified clinics convert</p>
          </div>

          {/* Visual donut-style breakdown */}
          <div className="space-y-3">
            {[
              { label: 'Monthly Revenue', value: forecast.monthlyRevenue, color: 'bg-emerald-500', textColor: 'text-emerald-400' },
              { label: 'Quarterly Revenue', value: forecast.quarterlyRevenue, color: 'bg-blue-500', textColor: 'text-blue-400' },
              { label: 'Annual Revenue', value: forecast.annualRevenue, color: 'bg-violet-500', textColor: 'text-violet-400' },
              { label: 'Full Pipeline', value: forecast.pipelineValue, color: 'bg-amber-500', textColor: 'text-amber-400' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3">
                <div className={cn('w-3 h-3 rounded-full shrink-0', item.color)} />
                <span className="text-xs text-slate-400 flex-1">{item.label}</span>
                <span className={cn('text-sm font-bold tabular-nums', item.textColor)}>
                  ${item.value >= 1000000 ? (item.value / 1000000).toFixed(2) + 'M' : (item.value / 1000).toFixed(1) + 'k'}
                </span>
              </div>
            ))}
          </div>

          {/* Conversion rate visual */}
          <div className="mt-6 p-4 bg-white/[0.03] rounded-xl border border-white/[0.04]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Close Rate</span>
              <span className="text-lg font-bold text-emerald-400 tabular-nums">{forecast.conversionRate}%</span>
            </div>
            <div className="h-3 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-700"
                style={{ width: `${forecast.conversionRate}%` }} />
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              {forecast.projectedClients} of {forecast.qualifiedClinics > 0 ? forecast.qualifiedClinics : forecast.clinicsWithEmail} {forecast.qualifiedClinics > 0 ? 'qualified' : 'reachable'} clinics → paying clients
            </p>
          </div>
        </div>

        {/* Insights + ROI explanation */}
        <div className="col-span-12 lg:col-span-7 space-y-4">

          {/* ROI Visual Card */}
          <div className="glass-card p-6 bg-gradient-to-br from-violet-600/10 to-novalyte-600/5 border-violet-500/10">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-slate-200">Clinic ROI Breakdown</h3>
            </div>
            <div className="flex items-center gap-6">
              {/* Visual flow: Lead Price → Close Rate → Patient LTV = ROI */}
              <div className="flex-1 flex items-center gap-3">
                <div className="text-center flex-1">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-novalyte-500/15 flex items-center justify-center mb-2 ring-1 ring-novalyte-500/20">
                    <span className="text-lg font-bold text-novalyte-400 tabular-nums">${forecast.avgLeadPrice}</span>
                  </div>
                  <p className="text-[10px] text-slate-500">Lead Cost</p>
                </div>
                <ArrowUpRight className="w-5 h-5 text-slate-600 shrink-0" />
                <div className="text-center flex-1">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/15 flex items-center justify-center mb-2 ring-1 ring-amber-500/20">
                    <span className="text-lg font-bold text-amber-400 tabular-nums">{forecast.avgCloseRate}%</span>
                  </div>
                  <p className="text-[10px] text-slate-500">Close Rate</p>
                </div>
                <ArrowUpRight className="w-5 h-5 text-slate-600 shrink-0" />
                <div className="text-center flex-1">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/15 flex items-center justify-center mb-2 ring-1 ring-emerald-500/20">
                    <span className="text-lg font-bold text-emerald-400 tabular-nums">${(forecast.avgPatientLTV / 1000).toFixed(1)}k</span>
                  </div>
                  <p className="text-[10px] text-slate-500">Patient LTV</p>
                </div>
                <span className="text-2xl font-bold text-slate-600">=</span>
                <div className="text-center flex-1">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-violet-500/20 to-emerald-500/20 flex items-center justify-center mb-2 ring-1 ring-violet-500/20">
                    <span className="text-lg font-bold text-violet-400 tabular-nums">{forecast.roiForClinic}x</span>
                  </div>
                  <p className="text-[10px] text-slate-500">ROI</p>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-4 leading-relaxed text-center">
              A clinic pays <span className="text-novalyte-400 font-medium">${forecast.avgLeadPrice}</span> per lead →
              <span className="text-amber-400 font-medium"> {forecast.avgCloseRate}%</span> become patients →
              each patient worth <span className="text-emerald-400 font-medium">${(forecast.avgPatientLTV / 1000).toFixed(1)}k</span> LTV →
              <span className="text-violet-400 font-bold"> {forecast.roiForClinic}x return</span>
            </p>
          </div>

          {/* AI Insights */}
          <div className="glass-card overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-accent-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Revenue Insights</h3>
                <p className="text-[10px] text-slate-600">Based on your pipeline data</p>
              </div>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {forecast.insights.map((insight, i) => (
                <div key={i} className="px-6 py-3.5 flex items-start gap-3 hover:bg-white/[0.02] transition-colors">
                  <CircleDot className={cn('w-4 h-4 mt-0.5 shrink-0', TEXT_COLORS[i % TEXT_COLORS.length])} />
                  <p className="text-xs text-slate-400 leading-relaxed">{insight}</p>
                </div>
              ))}
              {forecast.insights.length === 0 && (
                <div className="px-6 py-8 text-center">
                  <p className="text-xs text-slate-500">Add more clinics to generate insights</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Bottom: Per-Service Detail Cards ═══ */}
      {forecast.serviceBreakdown.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-novalyte-400" />
            <h3 className="text-sm font-semibold text-slate-200">Service Vertical Cards</h3>
            <span className="text-[10px] text-slate-500">— what each pre-qualified patient lead is worth</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {forecast.serviceBreakdown.map((svc, i) => {
              const Icon = getServiceIcon(svc.service);
              const textColor = TEXT_COLORS[i % TEXT_COLORS.length];
              const bgColor = BG_COLORS[i % BG_COLORS.length];
              const color = CHART_COLORS[i % CHART_COLORS.length];
              const svcROI = Math.round((svc.patientLTV * (forecast.avgCloseRate / 100)) / svc.avgCPL * 10) / 10;
              return (
                <div key={svc.service} className="glass-card p-5 relative overflow-hidden group hover:bg-white/[0.04] transition-all">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl opacity-10 rounded-bl-full pointer-events-none"
                    style={{ backgroundImage: `linear-gradient(to bottom left, var(--tw-gradient-stops))` }} />
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', bgColor)}>
                      <Icon className={cn('w-5 h-5', textColor)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-200 truncate">{svc.service}</p>
                      <p className="text-[10px] text-slate-500">{svc.clinics} clinic{svc.clinics !== 1 ? 's' : ''} in pipeline</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {/* Lead price — hero number */}
                    <div className="text-center py-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
                      <p className={cn('text-2xl font-bold tabular-nums', textColor)}>${svc.avgCPL}</p>
                      <p className="text-[10px] text-slate-500">per qualified lead</p>
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 bg-white/[0.02] rounded-lg">
                        <p className="text-[9px] text-slate-600">Patient LTV</p>
                        <p className="text-xs font-bold text-slate-300 tabular-nums">${(svc.patientLTV / 1000).toFixed(1)}k</p>
                      </div>
                      <div className="p-2 bg-white/[0.02] rounded-lg">
                        <p className="text-[9px] text-slate-600">Clinic ROI</p>
                        <p className={cn('text-xs font-bold tabular-nums', svcROI >= 5 ? 'text-emerald-400' : svcROI >= 3 ? 'text-amber-400' : 'text-slate-400')}>{svcROI}x</p>
                      </div>
                      <div className="p-2 bg-white/[0.02] rounded-lg">
                        <p className="text-[9px] text-slate-600">Leads/Mo</p>
                        <p className="text-xs font-bold text-slate-300 tabular-nums">{svc.monthlyLeads}</p>
                      </div>
                      <div className="p-2 bg-white/[0.02] rounded-lg">
                        <p className="text-[9px] text-slate-600">Revenue/Mo</p>
                        <p className={cn('text-xs font-bold tabular-nums', textColor)}>${svc.monthlyRevenue.toLocaleString()}</p>
                      </div>
                    </div>

                    {/* Mini revenue bar */}
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-700', color)}
                        style={{ width: `${(svc.monthlyRevenue / maxSvcRevenue) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
