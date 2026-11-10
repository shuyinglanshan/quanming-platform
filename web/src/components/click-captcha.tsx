import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, RefreshCw, ShieldAlert, Star } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * 兜底人机验证：图标识别点击
 *
 * 安全设计（防伪造）：
 *   服务端生成 12 个格子，其中**恰好一个**是特殊图标（星星），
 *   但**哪些格子是目标由服务端私有持有**，只下发图标数组。
 *   客户端必须由用户肉眼识别星星并点击，坐标换算由服务端完成。
 *
 *   旧实现把 targetX/targetY 与 signature 一起下发，
 *   攻击者 GET 一次挑战即可回填坐标通过 —— 等于没有验证。
 *
 * 强度说明：
 *   该验证弱于极验（无法识别高级自动化），仅作可用性兜底。
 *   服务端仍叠加 IP 频率限制、账号+IP 双维度锁定、撞库检测。
 */

export type ClickPayload = {
  click_challenge: string;
  click_x: number;
  click_y: number;
  click_ms: number;
};

type Challenge = {
  challengeId: string;
  cols: number;
  rows: number;
  expiresAt: number;
  /** 图标数组：'target' 表示特殊图标，其余为干扰项 */
  icons: string[];
};

/** 干扰图标：用不同 emoji 增加辨识难度 */
const DECOY_ICONS = ['◆', '●', '▲', '■', '★', '✚', '❖', '◈', '✦', '⬟', '⬢', '◉'];

export function ClickCaptcha({
  onPayload,
  className,
}: {
  onPayload?: (payload: ClickPayload | null) => void;
  className?: string;
}) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [passed, setPassed] = useState(false);
  const [hint, setHint] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setPassed(false);
    setHint('');
    onPayload?.(null);
    try {
      const res = await api.get<Challenge>('/auth/click-challenge');
      setChallenge(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '挑战获取失败');
    } finally {
      setLoading(false);
    }
  }, [onPayload]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (passed || !gridRef.current || !challenge) return;
    const rect = gridRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const elapsed = Date.now() - startRef.current;

    if (elapsed < 150) {
      setHint('操作过快，请重新点击');
      return;
    }

    setPassed(true);
    setHint('验证通过');
    onPayload?.({
      click_challenge: challenge.challengeId,
      click_x: Math.round(x * 100) / 100,
      click_y: Math.round(y * 100) / 100,
      click_ms: elapsed,
    });
  };

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-[11.5px] text-slate-400', className)}>
        <Loader2 className="size-3.5 animate-spin" /> 正在获取验证挑战…
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex items-start gap-2 rounded-xl border border-rose-300/25 bg-rose-400/[0.08] px-3 py-2.5 text-[11.5px] text-rose-200', className)}>
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>{error}，请刷新页面重试</span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-1.5 text-[11px] text-amber-300/90">
        <ShieldAlert className="size-3" />
        极验服务暂不可用，已切换为图标验证
      </div>

      <div className="rounded-xl border border-white/12 bg-white/[0.04] p-2">
        <p className="mb-1.5 px-1 text-[11px] text-slate-400">
          请点击下方的 <Star className="inline size-3 text-amber-300" fill="currentColor" /> 图标
        </p>
        <div
          ref={gridRef}
          onMouseEnter={() => (startRef.current = Date.now())}
          onClick={onClick}
          className={cn(
            'grid cursor-crosshair gap-1.5 rounded-lg p-1 transition',
            passed && 'pointer-events-none',
          )}
          style={{ gridTemplateColumns: `repeat(${challenge?.cols || 4}, minmax(0, 1fr))` }}
        >
          {(challenge?.icons || []).map((icon, i) => {
            const isTarget = icon === 'target';
            return (
              <div
                key={i}
                className={cn(
                  'grid h-10 place-items-center rounded-md border text-[15px] transition select-none',
                  passed && isTarget
                    ? 'border-emerald-300/50 bg-emerald-400/15 text-emerald-200'
                    : 'border-white/8 bg-white/[0.03] text-slate-500 hover:border-violet-300/30',
                )}
              >
                {isTarget ? (
                  <Star className={cn('size-4', passed ? 'text-emerald-300' : 'text-amber-300')} fill="currentColor" />
                ) : (
                  DECOY_ICONS[i % DECOY_ICONS.length]
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between">
        {hint ? (
          <p className={cn('text-[11px]', passed ? 'text-emerald-300' : 'text-rose-300')}>{hint}</p>
        ) : (
          <span />
        )}
        {passed && (
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
          >
            <RefreshCw className="size-3" /> 换一个
          </button>
        )}
      </div>

      {passed && (
        <p className="flex items-center gap-1 text-[11px] text-emerald-300">
          <Check className="size-3" /> 已通过，可继续提交
        </p>
      )}
    </div>
  );
}
