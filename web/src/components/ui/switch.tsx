import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-white/15',
        'transition-[background-color,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none',
        'data-[state=checked]:border-violet-400/50 data-[state=checked]:bg-violet-500/85',
        'data-[state=unchecked]:bg-white/10',
        'hover:border-white/25',
        'focus-visible:ring-4 focus-visible:ring-violet-500/20',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-3.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.4)]',
          'transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          'translate-x-0.5 data-[state=checked]:translate-x-[1.15rem]'
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
