import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-4 shrink-0 rounded-[5px] border border-white/25 bg-white/5 outline-none',
        'transition-[background-color,border-color,box-shadow,transform] duration-200',
        'hover:border-white/40',
        'data-[state=checked]:border-violet-400 data-[state=checked]:bg-violet-500 data-[state=checked]:text-white',
        'data-[state=checked]:shadow-[0_4px_12px_-4px_rgba(139,92,246,.9)]',
        'active:scale-90',
        'focus-visible:ring-4 focus-visible:ring-violet-500/20',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <CheckIcon className="size-3 animate-[scaleIn_0.18s_ease-out] " strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
