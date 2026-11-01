import { MessagesSquare } from 'lucide-react';
import { JOIN_GROUP_URL } from '@/lib/site';
import { cn } from '@/lib/utils';

export function JoinGroupButton({
  className,
  label = '加入交流群',
  variant = 'solid',
}: {
  className?: string;
  label?: string;
  variant?: 'solid' | 'ghost' | 'outline';
}) {
  const base =
    'group relative inline-flex items-center gap-2 overflow-hidden rounded-xl px-4 text-[13px] font-medium transition-all active:scale-[0.98]';
  const styles = {
    solid:
      'h-10 bg-gradient-to-r from-sky-500/90 to-violet-500/90 text-white shadow-[0_14px_36px_-18px_rgba(99,102,241,.95)] hover:from-sky-400 hover:to-violet-400',
    ghost: 'h-9 text-slate-300 hover:bg-white/8 hover:text-white',
    outline: 'h-10 border border-white/15 bg-white/[0.04] text-slate-200 backdrop-blur hover:border-white/25 hover:bg-white/[0.08]',
  }[variant];

  return (
    <a
      href={JOIN_GROUP_URL}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(base, styles, className)}
      title="点击跳转 QQ 群邀请链接"
    >
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      <MessagesSquare className="size-4 shrink-0" />
      <span className="relative">{label}</span>
    </a>
  );
}
