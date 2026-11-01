import { cn } from '@/lib/utils';

/** 全局背景光斑 + 网格，营造毛玻璃层次感 */
export function Aurora({ className }: { className?: string }) {
  return (
    <div
      className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}
      style={{ transform: 'translateZ(0)' }}
      aria-hidden
    >
      {/* aurora-orb：移动端由 CSS 关闭动画，避免持续重绘造成背景闪烁 */}
      <div className="aurora-orb absolute -top-40 -left-32 size-[36rem] rounded-full bg-violet-600/25 blur-[130px] animate-float" />
      <div
        className="aurora-orb absolute top-1/4 -right-40 size-[32rem] rounded-full bg-cyan-500/20 blur-[120px] animate-float"
        style={{ animationDelay: '-3s' }}
      />
      <div
        className="aurora-orb absolute -bottom-48 left-1/3 size-[34rem] rounded-full bg-fuchsia-600/16 blur-[140px] animate-float"
        style={{ animationDelay: '-6s' }}
      />
      <div
        className="absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 90% 60% at 50% 0%, #000 20%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 60% at 50% 0%, #000 20%, transparent 78%)',
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-20%,transparent_35%,#06060c_88%)]" />
    </div>
  );
}
