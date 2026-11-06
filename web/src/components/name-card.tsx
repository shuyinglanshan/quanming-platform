import { ArrowUpRight, Eye, Sparkles } from 'lucide-react';
import type { NameItem } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

export function NameCard({ item, onOpen, index = 0 }: { item: NameItem; onOpen?: () => void; index?: number }) {
  const hue = item.owner?.avatarHue ?? 260;

  return (
    <button
      onClick={onOpen}
      className={cn(
        'group liquid liquid-sheen animate-rise relative overflow-hidden rounded-2xl p-5 text-left',
        'transition-[transform,box-shadow,border-color] duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
        'hover:-translate-y-0.5 hover:border-white/16 hover:shadow-[0_20px_40px_-24px_rgba(139,92,246,.45)]',
        'active:translate-y-0 active:scale-[0.99]',
      )}
      style={{ animationDelay: `${Math.min(index * 45, 400)}ms` }}
    >

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[19px] font-semibold tracking-tight text-white">{item.name}</h3>
            <ArrowUpRight className="size-3.5 shrink-0 text-slate-600 transition group-hover:text-violet-300" />
          </div>
          <p className="mt-2 line-clamp-2 min-h-9 text-[12.5px] leading-relaxed text-slate-400">
            {item.description || '这位圈友还没有写下简介。'}
          </p>
        </div>
        <div
          className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/12 text-sm font-semibold text-white shadow-inner"
          style={{ background: `linear-gradient(135deg, hsl(${hue} 72% 52% / .9), hsl(${(hue + 55) % 360} 76% 42% / .85))` }}
        >
          {item.owner?.nickname?.slice(0, 1) || '圈'}
        </div>
      </div>

      <div className="relative mt-4 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Sparkles className="size-3 text-violet-300/80" />
          <span className="truncate text-[11.5px] text-slate-500">
            归属 · <span className="text-slate-300">{item.owner?.nickname || '未知'}</span>
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <Eye className="size-3" /> {item.views}
          </span>
          <span className="hidden sm:inline">{formatDate(item.approvedAt)}</span>
        </div>
      </div>

      {item.owner && (item.owner.bindings.qq || item.owner.bindings.wechat || item.owner.bindings.xiaohongshu) && (
        <div className="relative mt-2 flex gap-1.5">
          {item.owner.bindings.qq && (
            <span className="rounded-md border border-sky-300/20 bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-200">QQ</span>
          )}
          {item.owner.bindings.wechat && (
            <span className="rounded-md border border-emerald-300/20 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-200">
              微信
            </span>
          )}
          {item.owner.bindings.xiaohongshu && (
            <span className="rounded-md border border-rose-300/20 bg-rose-400/10 px-1.5 py-0.5 text-[10px] text-rose-200">
              小红书
            </span>
          )}
        </div>
      )}
    </button>
  );
}
