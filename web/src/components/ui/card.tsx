import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Card：液态玻璃卡片
 * variant=liquid 时启用光泽高光 + 内部流动光带 + 悬停浮起
 */
function Card({
  className,
  variant = 'glass',
  interactive = false,
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'glass' | 'liquid' | 'soft' | 'solid';
  interactive?: boolean;
}) {
  const base =
    'relative flex flex-col gap-5 rounded-3xl p-6 text-slate-100 transition-[transform,box-shadow,border-color,background] duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)]';

  const variants = {
    glass: 'glass',
    liquid: 'liquid liquid-sheen',
    soft: 'glass-soft',
    solid: 'glass-strong',
  };

  return (
    <div
      data-slot="card"
      className={cn(
        base,
        variants[variant],
        interactive &&
          'cursor-pointer hover:-translate-y-1 hover:border-white/22 hover:shadow-[0_28px_64px_-30px_rgba(139,92,246,.55)] active:translate-y-0 active:scale-[0.994]',
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('text-base font-semibold tracking-tight text-white', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-[13px] leading-relaxed text-slate-400', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center', className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
