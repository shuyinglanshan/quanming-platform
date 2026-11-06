import { useEffect } from 'react';

/**
 * 液态玻璃指针跟随
 * 给带有 .liquid-glass 的元素注入 --mx / --my 变量，
 * 使高光跟随指针移动（CSS 里用 radial-gradient 读取）。
 *
 * 性能优化：
 * - 使用 requestAnimationFrame 节流，避免高频事件触发重绘
 * - 仅在带 data-liquid 的容器内生效，减少全局监听开销
 * - 触摸设备自动跳过（移动端无 hover 语义）
 */
export function LiquidPointer() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // 触摸设备跳过
    if (window.matchMedia?.('(hover: none)').matches) return;

    let raf = 0;
    let pending: { el: HTMLElement; x: number; y: number } | null = null;
    let lastEl: HTMLElement | null = null;

    const apply = () => {
      raf = 0;
      if (!pending) return;
      const { el, x, y } = pending;
      // 只在元素真正变化时才写样式，避免每帧都强制重绘
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${x - rect.left}px`);
      el.style.setProperty('--my', `${y - rect.top}px`);
      lastEl = el;
      pending = null;
    };

    const onMove = (e: PointerEvent) => {
      // 只在 hover 容器上生效，避免全局无效计算
      const target = (e.target as HTMLElement)?.closest?.('.liquid-glass') as HTMLElement | null;
      if (!target) {
        if (lastEl) lastEl = null;
        return;
      }
      if (pending?.el === target && pending.x === e.clientX && pending.y === e.clientY) return;
      pending = { el: target, x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(apply);
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
