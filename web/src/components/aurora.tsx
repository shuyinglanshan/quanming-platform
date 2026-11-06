import { cn } from '@/lib/utils';

/**
 * 背景层（清爽版）
 *
 * 重构前：3 个 130px+ 模糊光斑 + 网格 mask + 持续动画，
 *         移动端 GPU 压力大且容易闪屏。
 * 重构后：
 *   - 单个柔和径向渐变，不用 blur 滤镜
 *   - 极慢的整体呼吸（transform-only，避免重绘）
 *   - 移动端直接关闭动画
 */
export function Aurora({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)} aria-hidden>
      {/* 顶部主色光晕：不用 blur，用渐变本身的过渡实现 */}
      <div
        className="aurora-orb absolute -top-[18rem] left-1/2 h-[34rem] w-[60rem] -translate-x-1/2 rounded-full opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(139,92,246,0.22), rgba(139,92,246,0.06) 55%, transparent 78%)',
        }}
      />
      {/* 右下辅助冷色，让深色背景不死板 */}
      <div
        className="absolute -right-40 bottom-[-10rem] h-[26rem] w-[30rem] rounded-full opacity-50"
        style={{
          background:
            'radial-gradient(ellipse 55% 50% at 50% 50%, rgba(34,211,238,0.10), transparent 72%)',
        }}
      />
      {/* 极淡网格，增加一点结构感但不喧宾夺主 */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage: 'radial-gradient(ellipse 80% 55% at 50% 0%, #000 15%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 55% at 50% 0%, #000 15%, transparent 75%)',
        }}
      />
      {/* 四周渐隐，保证文字区域始终是高对比度 */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,transparent_45%,#06060c_92%)]" />
    </div>
  );
}
