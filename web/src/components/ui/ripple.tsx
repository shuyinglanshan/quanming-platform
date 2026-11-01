import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 点击涟漪效果
 * 包裹任意可点击元素，点击时从落点扩散光晕
 */
export function useRipple<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);

  const createRipple = React.useCallback((e: React.PointerEvent<T>) => {
    const host = ref.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const dot = document.createElement('span');
    dot.className = 'ripple-dot';
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.left = `${e.clientX - rect.left - size / 2}px`;
    dot.style.top = `${e.clientY - rect.top - size / 2}px`;
    host.appendChild(dot);
    setTimeout(() => dot.remove(), 640);
  }, []);

  return { ref, createRipple };
}

/** 便捷包装：给子元素点击加涟漪 */
export function Ripple({ className, children, ...props }: React.ComponentProps<'div'>) {
  const { ref, createRipple } = useRipple<HTMLDivElement>();
  return (
    <div ref={ref} onPointerDown={createRipple} className={cn('ripple-host', className)} {...props}>
      {children}
    </div>
  );
}
