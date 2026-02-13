import { motion } from 'framer-motion';

export default function TreatmentDemandBars({
  treatments,
  totalLeads,
}: {
  treatments: Array<[string, number]>;
  totalLeads: number;
}) {
  const rows = treatments.slice(0, 6);

  return (
    <div className="glass-card p-4 h-full">
      <h2 className="text-sm font-semibold text-slate-200 mb-3">Treatment Interest</h2>
      {rows.length === 0 ? (
        <p className="text-[10px] text-slate-600 py-2">No data yet</p>
      ) : (
        <div className="space-y-3">
          {rows.map(([treatment, count], idx) => {
            const pct = totalLeads ? Math.round((count / totalLeads) * 100) : 0;
            return (
              <div key={treatment}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-300 truncate capitalize pr-2">{normalizeTreatment(treatment)}</span>
                  <span className="text-[10px] text-novalyte-300 font-semibold">{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden relative">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(4, pct)}%` }}
                    transition={{ duration: 0.75, delay: idx * 0.08, ease: 'easeOut' }}
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500/80 to-blue-500/90 shadow-[0_0_14px_rgba(59,130,246,0.5)]"
                  />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">{count} leads</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function normalizeTreatment(raw: string) {
  const v = String(raw || '').toLowerCase();
  if (v.includes('trt') || v.includes('testosterone')) return 'TRT';
  if (v.includes('weight') || v.includes('glp') || v.includes('semaglutide')) return 'Weight Loss';
  if (v.includes('peptide')) return 'Peptides';
  return raw;
}
