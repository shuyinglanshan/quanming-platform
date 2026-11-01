import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export type TrendPoint = {
  date: string;
  label: string;
  users: number;
  claims: number;
  approved: number;
  rejected: number;
  visits: number;
};

const SERIES = [
  { key: 'visits', label: '访问量', color: '#a78bfa', fill: 'rgba(167,139,250,0.22)' },
  { key: 'claims', label: '申请量', color: '#22d3ee', fill: 'rgba(34,211,238,0.18)' },
  { key: 'approved', label: '通过数', color: '#34d399', fill: 'rgba(52,211,153,0.16)' },
] as const;

/** 轻量 SVG 面积图（无第三方依赖） */
export function TrendChart({ data, height = 210 }: { data: TrendPoint[]; height?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const width = 720;
  const padding = { top: 16, right: 12, bottom: 26, left: 30 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const max = useMemo(() => {
    const m = Math.max(1, ...data.flatMap((d) => SERIES.map((s) => Number(d[s.key]) || 0)));
    return Math.ceil(m * 1.15);
  }, [data]);

  const x = (i: number) => padding.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => padding.top + innerH - (v / max) * innerH;

  const pathFor = (key: (typeof SERIES)[number]['key']) =>
    data
      .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(d[key]) || 0).toFixed(1)}`)
      .join(' ');

  const areaFor = (key: (typeof SERIES)[number]['key']) =>
    `${pathFor(key)} L${x(data.length - 1)},${padding.top + innerH} L${x(0)},${padding.top + innerH} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(max * r));

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11.5px] text-slate-400">
            <span className="size-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-slate-600">近 14 天</span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          onMouseLeave={() => setActive(null)}
          preserveAspectRatio="none"
        >
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.fill} />
                <stop offset="100%" stopColor="transparent" />
              </linearGradient>
            ))}
          </defs>

          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y(t)}
                y2={y(t)}
                stroke="rgba(255,255,255,.07)"
                strokeDasharray={i === 0 ? '0' : '3 5'}
              />
              <text x={padding.left - 8} y={y(t) + 3} textAnchor="end" fontSize="9" fill="rgba(148,163,184,.6)">
                {t}
              </text>
            </g>
          ))}

          {SERIES.map((s) => (
            <g key={s.key}>
              <path d={areaFor(s.key)} fill={`url(#grad-${s.key})`} />
              <path
                d={pathFor(s.key)}
                fill="none"
                stroke={s.color}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}

          {data.map((d, i) => (
            <g key={d.date}>
              <rect
                x={x(i) - innerW / data.length / 2}
                y={padding.top}
                width={innerW / data.length}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
              />
              {i % 2 === 0 && (
                <text x={x(i)} y={height - 8} textAnchor="middle" fontSize="9" fill="rgba(148,163,184,.55)">
                  {d.label}
                </text>
              )}
            </g>
          ))}

          {active !== null && data[active] && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={padding.top}
                y2={padding.top + innerH}
                stroke="rgba(255,255,255,.25)"
                strokeDasharray="3 3"
              />
              {SERIES.map((s) => (
                <circle key={s.key} cx={x(active)} cy={y(Number(data[active][s.key]) || 0)} r="3" fill={s.color} stroke="#0a0a13" strokeWidth="1.5" />
              ))}
            </g>
          )}
        </svg>

        {active !== null && data[active] && (
          <div
            className="glass-strong pointer-events-none absolute top-2 z-10 min-w-32 rounded-xl px-3 py-2 text-[11px]"
            style={{ left: `min(max(${(x(active) / width) * 100}%, 64px), calc(100% - 90px))`, transform: 'translateX(-50%)' }}
          >
            <div className="mb-1 font-medium text-white">{data[active].date}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-3 text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="text-slate-200">{data[active][s.key]}</span>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-white/10 pt-1 text-slate-400">
              <span>新用户</span>
              <span className="text-slate-200">{data[active].users}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 分类占比横向条形 */
export function CategoryBars({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const colors = ['#a78bfa', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#94a3b8'];
  return (
    <div className="space-y-2.5">
      {data.length === 0 && <p className="text-[12px] text-slate-500">暂无数据</p>}
      {data.map((d, i) => (
        <div key={d.name}>
          <div className="mb-1 flex items-center justify-between text-[11.5px]">
            <span className="text-slate-300">{d.name}</span>
            <span className="text-slate-500">
              {d.value} · {Math.round((d.value / total) * 100)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${(d.value / total) * 100}%`, background: colors[i % colors.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'violet',
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: 'violet' | 'cyan' | 'emerald' | 'amber' | 'rose';
  className?: string;
}) {
  const tones = {
    violet: 'from-violet-500/25 to-indigo-500/5 text-violet-200',
    cyan: 'from-cyan-500/25 to-sky-500/5 text-cyan-200',
    emerald: 'from-emerald-500/25 to-teal-500/5 text-emerald-200',
    amber: 'from-amber-500/25 to-orange-500/5 text-amber-200',
    rose: 'from-rose-500/25 to-red-500/5 text-rose-200',
  }[accent];

  return (
    <div className={cn('glass relative overflow-hidden rounded-2xl p-4', className)}>
      <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70', tones)} />
      <div className="relative">
        <div className="flex items-start justify-between">
          <span className="text-[11.5px] text-slate-400">{label}</span>
          <div className={cn('grid size-8 place-items-center rounded-lg border border-white/10 bg-white/[0.06]')}>
            <Icon className="size-3.5" />
          </div>
        </div>
        <div className="mt-2.5 text-[26px] leading-none font-semibold tracking-tight text-white">{value}</div>
        {hint && <div className="mt-1.5 text-[11px] text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}
