import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-200 [&>svg]:size-3 hover:scale-[1.03]',
  {
    variants: {
      variant: {
        default: 'border-violet-300/30 bg-violet-400/15 text-violet-200 shadow-[inset_0_1px_0_rgba(255,255,255,.1)]',
        secondary: 'border-white/12 bg-white/[0.07] text-slate-300',
        outline: 'border-white/20 bg-transparent text-slate-300',
        success: 'border-emerald-300/30 bg-emerald-400/12 text-emerald-200 shadow-[inset_0_1px_0_rgba(255,255,255,.08)]',
        warning: 'border-amber-300/30 bg-amber-400/12 text-amber-200 shadow-[inset_0_1px_0_rgba(255,255,255,.08)]',
        danger: 'border-rose-300/30 bg-rose-400/12 text-rose-200 shadow-[inset_0_1px_0_rgba(255,255,255,.08)]',
        cyan: 'border-cyan-300/30 bg-cyan-400/12 text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,.08)]',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
