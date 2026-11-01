import { cn } from '@/lib/utils';

export function Logo({ className, size = 34 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-[11px] border border-white/15 bg-gradient-to-br from-violet-500/30 via-indigo-500/15 to-cyan-400/25 shadow-[0_8px_24px_-12px_rgba(139,92,246,.9)]',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" width={size * 0.62} height={size * 0.62} fill="none">
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e9d5ff" />
            <stop offset="55%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="10.5" stroke="url(#logo-g)" strokeWidth="2" strokeLinecap="round" strokeDasharray="52 14" />
        <circle cx="16" cy="16" r="3.4" fill="url(#logo-g)" />
        <circle cx="16" cy="5.5" r="1.6" fill="#67e8f9" />
      </svg>
    </span>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight text-white">小天才圈名</span>
          <span className="mt-0.5 text-[10px] tracking-[0.22em] text-slate-500 uppercase">Quanming Registry</span>
        </span>
      )}
    </span>
  );
}
