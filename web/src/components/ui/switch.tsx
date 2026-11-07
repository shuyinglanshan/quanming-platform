import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

/**
 * 开关
 * 尺寸与对比度经过调校：未选中态也能清晰看出是「可点击的开关」，
 * 避免在深色背景上因 thumb 与轨道同色而"看不见"。
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full',
        'border transition-colors duration-300 outline-none',
        // 未选中：浅灰轨道 + 亮色描边，确保可见
        'border-white/25 bg-white/[0.14]',
        // 选中：紫色实心
        'data-[state=checked]:border-violet-400/60 data-[state=checked]:bg-violet-500',
        'hover:border-white/40',
        'focus-visible:ring-4 focus-visible:ring-violet-500/25',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4.5 rounded-full',
          'bg-white shadow-[0_1px_4px_rgba(0,0,0,.5)]',
          'transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          // 未选中时也保持纯白，与灰轨道形成对比
          'translate-x-[3px] data-[state=checked]:translate-x-[23px]',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
