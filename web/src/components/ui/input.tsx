import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-11 w-full min-w-0 rounded-xl border border-white/12 bg-white/[0.045] px-3.5 py-2 text-sm text-slate-100',
        'shadow-[inset_0_1px_0_rgba(255,255,255,.06)] outline-none',
        'transition-[border-color,background-color,box-shadow] duration-200 ease-out',
        'placeholder:text-slate-500 selection:bg-violet-500/40',
        'hover:border-white/20 hover:bg-white/[0.06]',
        'focus-visible:border-violet-400/55 focus-visible:bg-white/[0.08] focus-visible:shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_0_0_4px_rgba(139,92,246,.14)]',
        // 确保输入框始终可选中/可粘贴，不受外层 select-none 影响
        'select-text',
        'touch-manipulation',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:mr-2 file:rounded-lg file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-slate-200',
        className
      )}
      {...props}
    />
  );
}

export { Input };
