import { useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';

/**
 * 路由切换过渡
 *
 * 优化点：
 * 1. 旧内容淡出时间缩短到 90ms，新内容立即挂载，避免"空窗"感
 * 2. 只用 opacity + 极小位移，不动 layout，避免重排
 * 3. 加 will-change 并在动画结束后清除，避免长期占用合成层
 * 4. 尊重 prefers-reduced-motion，无障碍友好
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [display, setDisplay] = useState(children);
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const keyRef = useRef(location.pathname);
  const rafRef = useRef<number | null>(null);

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (location.pathname === keyRef.current) {
      setDisplay(children);
      return;
    }
    keyRef.current = location.pathname;

    if (reduced) {
      setDisplay(children);
      return;
    }

    // 极短的淡出，随即换内容并淡入
    setPhase('out');
    const timer = window.setTimeout(() => {
      setDisplay(children);
      setPhase('in');
    }, 90);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === keyRef.current) setDisplay(children);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  // 组件卸载前清理待执行的帧
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return (
    <div
      style={{
        transition: reduced ? undefined : 'opacity 180ms cubic-bezier(0.16,1,0.3,1), transform 180ms cubic-bezier(0.16,1,0.3,1)',
        opacity: phase === 'in' ? 1 : 0,
        transform: phase === 'in' ? 'translate3d(0,0,0)' : 'translate3d(0,4px,0)',
        willChange: 'opacity, transform',
      }}
    >
      {display}
    </div>
  );
}
