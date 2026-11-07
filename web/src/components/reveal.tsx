import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * 滚动进入视口时淡入上浮
 * 使用 IntersectionObserver，性能友好，且只触发一次
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'section' | 'li' | 'article';
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 减少动效偏好时直接显示
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={cn(
        'transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
        // 仅在动画进行中启用 will-change；结束后清除，避免永久创建层叠上下文
        // （层叠上下文会把内部绝对定位弹层的 z-index 限制在容器内，
        //   导致搜索建议被下方按钮遮挡）
        shown ? 'opacity-100 will-change-auto' : 'translate-y-3 opacity-0 will-change-[opacity,transform]',
        // 动画结束后彻底移除 transform，恢复正常文档流与层叠关系
        className
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
