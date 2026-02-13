import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS: Record<string, string> = {
  mobile: '#22d3ee',
  desktop: '#3b82f6',
  tablet: '#a855f7',
};

interface Slice {
  name: string;
  value: number;
  conversionRate: number;
}

function BreakdownTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload as Slice | undefined;
  if (!item) return null;

  return (
    <div
      style={{
        background: 'rgba(2, 6, 23, 0.96)',
        border: '1px solid rgba(34, 211, 238, 0.45)',
        borderRadius: 12,
        padding: '10px 12px',
        color: '#f8fafc',
        boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{item.name}</div>
      <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>{item.value} users</div>
      <div style={{ fontSize: 12, color: '#22d3ee', fontWeight: 600, marginTop: 2 }}>
        {item.conversionRate}% conversion rate
      </div>
    </div>
  );
}

export default function DeviceTechRing({
  mobile,
  desktop,
  tablet,
  total,
  conversionRates,
}: {
  mobile: number;
  desktop: number;
  tablet: number;
  total: number;
  conversionRates: { mobile: number; desktop: number; tablet: number };
}) {
  const data: Slice[] = [
    { name: 'Mobile', value: mobile, conversionRate: conversionRates.mobile },
    { name: 'Desktop', value: desktop, conversionRate: conversionRates.desktop },
    { name: 'Tablet', value: tablet, conversionRate: conversionRates.tablet },
  ].filter(d => d.value > 0);

  return (
    <div className="glass-card p-4 h-full">
      <h2 className="text-sm font-semibold text-slate-200 mb-3">Device Breakdown</h2>
      <div className="h-[210px] relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={62}
              outerRadius={92}
              strokeWidth={10}
              stroke="#0b1220"
              paddingAngle={2}
              isAnimationActive
              animationDuration={900}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={COLORS[entry.name.toLowerCase()] || '#64748b'} filter="url(#glow)" />
              ))}
            </Pie>
            <Tooltip
              cursor={false}
              wrapperStyle={{ outline: 'none', zIndex: 40 }}
              content={<BreakdownTooltip />}
            />
          </PieChart>
        </ResponsiveContainer>

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-[11px] text-slate-500 uppercase tracking-wider">Sessions</p>
            <p className="text-2xl font-bold text-slate-100 tabular-nums">{total.toLocaleString()}</p>
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
        <LegendChip label="Mobile" color={COLORS.mobile} />
        <LegendChip label="Desktop" color={COLORS.desktop} />
        <LegendChip label="Tablet" color={COLORS.tablet} />
      </div>
    </div>
  );
}

function LegendChip({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 text-slate-400">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}
