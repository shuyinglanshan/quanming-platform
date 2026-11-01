import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl bg-white/[0.07]',
        'before:absolute before:inset-0 before:-translate-x-full',
        'before:bg-gradient-to-r before:from-transparent before:via-white/[0.12] before:to-transparent',
        'before:animate-[shimmer_1.8s_infinite]',
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
