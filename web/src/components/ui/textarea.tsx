import * as React from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-24 w-full rounded-xl border border-white/12 bg-white/[0.045] px-3.5 py-3 text-sm leading-relaxed text-slate-100',
        'shadow-[inset_0_1px_0_rgba(255,255,255,.06)] outline-none',
        'transition-[border-color,background-color,box-shadow] duration-200 ease-out',
        'placeholder:text-slate-500',
        'hover:border-white/20 hover:bg-white/[0.06]',
        'focus-visible:border-violet-400/55 focus-visible:bg-white/[0.08] focus-visible:shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_0_0_4px_rgba(139,92,246,.14)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
