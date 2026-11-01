import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

/**
 * TabsList
 * 移动端：自动换行，避免 5 个标签横向溢出屏幕
 * 桌面端：单行排列
 */
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex h-auto min-h-10 items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1 backdrop-blur-xl',
        'shadow-[inset_0_1px_0_rgba(255,255,255,.08)]',
        // 小屏换行；sm 以上恢复单行
        'flex-wrap sm:flex-nowrap',
        'w-full sm:w-auto',
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap',
        'text-slate-400 transition-[color,background-color,box-shadow,transform] duration-200 ease-out',
        'hover:text-slate-100 active:scale-[0.97]',
        'focus-visible:ring-2 focus-visible:ring-violet-400/45 focus-visible:outline-none',
        'data-[state=active]:bg-white/[0.13] data-[state=active]:text-white',
        'data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,.2),0_6px_16px_-10px_rgba(139,92,246,.9)]',
        '[&_svg]:size-3.5',
        // 小屏自动伸展，让换行后每行排布均匀
        'flex-1 sm:flex-initial',
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'outline-none',
        'data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1',
        'data-[state=active]:duration-300',
        className
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
