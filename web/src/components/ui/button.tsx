import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-xl text-sm font-medium',
    'outline-none select-none',
    // 平滑过渡：位移 / 阴影 / 颜色 / 亮度
    'relative overflow-hidden transition-[transform,box-shadow,background-color,border-color,color,filter] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
    'ease-[cubic-bezier(0.22,1,0.36,1)]',
    'hover:-translate-y-px active:translate-y-0 active:scale-[0.968] active:duration-100',
    'disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:scale-100',
    'focus-visible:ring-2 focus-visible:ring-violet-400/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080f]',
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
    // 内部高光，模拟玻璃边缘
    'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/45 before:to-transparent before:opacity-60',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-b from-violet-500 to-indigo-600 text-white shadow-[0_10px_28px_-12px_rgba(139,92,246,.95),inset_0_1px_0_rgba(255,255,255,.22)] hover:from-violet-400 hover:to-indigo-500 hover:shadow-[0_16px_38px_-12px_rgba(139,92,246,.95),inset_0_1px_0_rgba(255,255,255,.28)] active:shadow-[0_6px_18px_-10px_rgba(139,92,246,.9)]',
        secondary:
          'border border-white/12 bg-white/[0.07] text-slate-100 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,.1)] hover:border-white/22 hover:bg-white/[0.13]',
        outline:
          'border border-white/16 bg-white/[0.02] text-slate-200 backdrop-blur-md hover:border-white/28 hover:bg-white/[0.08] hover:text-white',
        ghost: 'text-slate-300 hover:bg-white/[0.08] hover:text-white',
        destructive:
          'bg-gradient-to-b from-rose-500 to-red-600 text-white shadow-[0_10px_26px_-12px_rgba(244,63,94,.9),inset_0_1px_0_rgba(255,255,255,.2)] hover:from-rose-400 hover:to-red-500 hover:shadow-[0_16px_34px_-12px_rgba(244,63,94,.9)]',
        success:
          'bg-gradient-to-b from-emerald-500 to-teal-600 text-white shadow-[0_10px_26px_-12px_rgba(16,185,129,.9),inset_0_1px_0_rgba(255,255,255,.2)] hover:from-emerald-400 hover:to-teal-500 hover:shadow-[0_16px_34px_-12px_rgba(16,185,129,.9)]',
        glass:
          'border border-white/14 bg-white/[0.08] text-white backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,.18),0_12px_30px_-18px_rgba(0,0,0,.9)] hover:border-white/26 hover:bg-white/[0.14] hover:shadow-[inset_0_1px_0_rgba(255,255,255,.24),0_18px_40px_-18px_rgba(139,92,246,.6)]',
        link: 'text-violet-300 underline-offset-4 hover:text-violet-200 hover:underline before:hidden',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-lg px-3 text-xs before:via-white/35',
        lg: 'h-12 rounded-2xl px-7 text-[15px]',
        icon: 'size-10 rounded-xl px-0',
        'icon-sm': 'size-8 rounded-lg px-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  children,
  onPointerDown,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';

  // 点击涟漪：直接操作 DOM，避免额外 setState 造成重渲染
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const host = e.currentTarget;
      if (host && !host.hasAttribute('disabled')) {
        const rect = host.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const dot = document.createElement('span');
        dot.className = 'ripple-dot';
        dot.style.width = `${size}px`;
        dot.style.height = `${size}px`;
        dot.style.left = `${e.clientX - rect.left - size / 2}px`;
        dot.style.top = `${e.clientY - rect.top - size / 2}px`;
        host.appendChild(dot);
        window.setTimeout(() => dot.remove(), 640);
      }
      onPointerDown?.(e);
    },
    [onPointerDown]
  );

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      onPointerDown={handlePointerDown}
      {...props}
    >
      {children}
    </Comp>
  );
}

export { Button, buttonVariants };
