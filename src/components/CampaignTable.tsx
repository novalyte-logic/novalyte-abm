import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, MousePointerClick, Target } from 'lucide-react';
import { cn } from '../utils/cn';

export interface CampaignLead {
  id: string;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  status: string;
  match_score: number | null;
  geo_city: string | null;
  geo_state: string | null;
}

export interface CampaignAffluenceSource {
  city?: string | null;
  state?: string | null;
  affluence_score?: number | null;
}

interface CampaignRow {
  campaign: string;
  leads: CampaignLead[];
  leadCount: number;
  conversions: number;
  conversionRate: number;
  avgMatchScore: number;
  pipelineValue: number;
  affluenceScore: number;
  keywords: Array<{ term: string; count: number }>;
}

function cityStateKey(city?: string | null, state?: string | null) {
  return `${(city || '').trim().toLowerCase()}|${(state || '').trim().toLowerCase()}`;
}

export default function CampaignTable({
  leads,
  affluenceSources,
}: {
  leads: CampaignLead[];
  affluenceSources: CampaignAffluenceSource[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const affluenceByCity = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of affluenceSources) {
      const key = cityStateKey((s as any).city, (s as any).state);
      if (!key || key === '|') continue;
      const score = Number((s as any).affluence_score ?? (s as any).affluenceScore ?? 0);
      if (Number.isFinite(score) && score > 0) m.set(key, score);
    }
    return m;
  }, [affluenceSources]);

  const rows = useMemo<CampaignRow[]>(() => {
    const byCampaign = new Map<string, CampaignLead[]>();
    for (const l of leads) {
      const key = l.utm_campaign || 'Unknown Campaign';
      if (!byCampaign.has(key)) byCampaign.set(key, []);
      byCampaign.get(key)!.push(l);
    }

    const out: CampaignRow[] = [];
    for (const [campaign, cls] of byCampaign.entries()) {
      const leadCount = cls.length;
      const conversions = cls.filter(l => l.status !== 'new').length;
      const conversionRate = leadCount ? Math.round((conversions / leadCount) * 100) : 0;
      const avgMatchScore = cls.filter(l => l.match_score != null).length
        ? Math.round(cls.filter(l => l.match_score != null).reduce((s, l) => s + Number(l.match_score || 0), 0) / cls.filter(l => l.match_score != null).length)
        : 0;
      const pipelineValue = leadCount * 2500;

      const keywordMap = new Map<string, number>();
      cls.forEach(l => {
        const term = (l.utm_term || l.utm_content || '').trim();
        if (!term) return;
        keywordMap.set(term, (keywordMap.get(term) || 0) + 1);
      });

      const affValues = cls
        .map(l => affluenceByCity.get(cityStateKey(l.geo_city, l.geo_state)))
        .filter((v): v is number => typeof v === 'number');
      const affluenceScore = affValues.length ? Number((affValues.reduce((a, b) => a + b, 0) / affValues.length).toFixed(1)) : 0;

      out.push({
        campaign,
        leads: cls,
        leadCount,
        conversions,
        conversionRate,
        avgMatchScore,
        pipelineValue,
        affluenceScore,
        keywords: Array.from(keywordMap.entries())
          .map(([term, count]) => ({ term, count }))
          .sort((a, b) => b.count - a.count),
      });
    }

    return out.sort((a, b) => b.leadCount - a.leadCount);
  }, [leads, affluenceByCity]);

  return (
    <div className="glass-card p-4">
      <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
        <MousePointerClick className="w-4 h-4 text-novalyte-400" />
        Campaign Performance
      </h2>

      {rows.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-xs text-slate-500">No campaign data yet</p>
          <p className="text-[10px] text-slate-600 mt-1">Capture UTM campaign/term/content to populate this table</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const isExpanded = expanded.has(row.campaign);
            const rowTone = row.conversionRate < 5
              ? 'border-red-500/30 bg-red-500/10'
              : row.conversionRate > 15
                ? 'border-amber-400/40 bg-amber-400/10'
                : 'border-white/[0.06] bg-white/[0.02]';

            return (
              <div key={row.campaign} className={cn('rounded-xl border p-3', rowTone)}>
                <button
                  onClick={() => {
                    const next = new Set(expanded);
                    if (next.has(row.campaign)) next.delete(row.campaign);
                    else next.add(row.campaign);
                    setExpanded(next);
                  }}
                  className="w-full text-left flex items-center gap-2"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                  <span className="text-sm font-medium text-slate-200 flex-1 truncate">{row.campaign}</span>
                  <span className="text-xs text-slate-400">{row.leadCount} leads</span>
                </button>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3 text-xs">
                  <div>
                    <p className="text-slate-500">Conversion</p>
                    <p className={cn('font-semibold', row.conversionRate < 5 ? 'text-red-300' : row.conversionRate > 15 ? 'text-amber-300' : 'text-slate-200')}>
                      {row.conversionRate}%
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Leads</p>
                    <p className="text-slate-200 font-semibold">{row.leadCount}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Pipeline Value</p>
                    <p className="text-emerald-300 font-semibold">${row.pipelineValue.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 flex items-center gap-1"><Target className="w-3 h-3" /> Affluence</p>
                    <p className="text-blue-300 font-semibold">{row.affluenceScore || '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Match Score</p>
                    <p className="text-slate-200 font-semibold">{row.avgMatchScore || '—'}%</p>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-white/[0.08]">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Keywords (utm_term / utm_content)</p>
                    {row.keywords.length === 0 ? (
                      <p className="text-[11px] text-slate-500">No keywords tracked</p>
                    ) : (
                      <div className="space-y-1.5">
                        {row.keywords.slice(0, 12).map(k => (
                          <div key={`${row.campaign}-${k.term}`} className="flex items-center justify-between text-xs">
                            <span className="text-slate-300 truncate pr-2">{k.term}</span>
                            <span className="text-novalyte-300 font-semibold">{k.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
