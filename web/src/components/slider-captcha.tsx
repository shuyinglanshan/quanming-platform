import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Loader2, RotateCw, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export type CaptchaState = { id: string | null; verified: boolean };

const HANDLE = 44; // 手柄尺寸（px）

/**
 * 滑块验证：按住滑块滑到最右端即通过
 * - 拖尾随手指实时跟随（progress 为 0~1）
 * - 未到底松手自动回弹
 * - 到底后调用 /auth/captcha/verify 标记通过，注册时一次性消费
 */
export function SliderCaptcha({
  onChange,
  resetKey = 0,
  disabled,
}: {
  onChange: (state: CaptchaState) => void;
  /** 变化时重新获取挑战（例如提交失败后） */
  resetKey?: number;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const loadingRef = useRef(false);

  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0); // 0-1，拖尾实时跟随
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');

  /** 拉取挑战（并发去重 + 指数退避重试） */
  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setStatus('idle');
    setProgress(0);
    setError('');

    try {
      const data = await api.get<{ id: string }>('/auth/captcha', { cache: 'no-store' } as RequestInit);
      setChallengeId(data.id);
      setError('');
      onChangeRef.current({ id: data.id, verified: false });
    } catch (err: any) {
      setChallengeId(null);
      setError(err?.message || '网络异常');
      onChangeRef.current({ id: null, verified: false });
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, resetKey, retry]);

  const ratioFromX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const usable = rect.width - HANDLE - 8;
    const raw = (clientX - rect.left - HANDLE / 2 - 4) / usable;
    return Math.max(0, Math.min(1, raw));
  };

  const finish = () => {
    setProgress(1);
    // 立即呈现通过状态，不等待网络
    setProgress(1);
    onChangeRef.current({ id: challengeId, verified: true });

    // 后台静默确认（失败时回滚）
    if (challengeId) {
      api
        .post('/auth/captcha/verify', { id: challengeId })
        .then(() => setStatus('ok'))
        .catch((err: any) => {
          setStatus('fail');
          setError(err?.message || '验证失败，请重试');
          onChangeRef.current({ id: null, verified: false });
          setProgress(0);
          setRetry((v) => v + 1);
        });
    } else {
      setStatus('ok');
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || status === 'ok' || status === 'checking' || loading || !challengeId) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    setStatus('idle');
    setProgress(ratioFromX(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setProgress(ratioFromX(e.clientX));
  };

  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (progress >= 0.97) {
      setStatus('ok');
      finish();
    } else {
      // 未到底，回弹
      setProgress(0);
    }
  };

  const done = status === 'ok';
  const trackProgress = done ? 1 : progress;

  return (
    <div className="space-y-2">
      <div
        ref={trackRef}
        className={cn(
          'relative h-12 w-full touch-none overflow-hidden rounded-xl border transition-colors select-none',
          done
            ? 'border-emerald-300/40 bg-emerald-400/10'
            : status === 'fail'
              ? 'border-rose-300/40 bg-rose-400/10'
              : 'border-white/12 bg-white/[0.045]',
          disabled && 'opacity-60',
        )}
      >
        {/* 拖尾：实时跟随滑块 */}
        <div
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0',
            done
              ? 'bg-gradient-to-r from-emerald-400/10 via-emerald-400/20 to-emerald-400/35'
              : 'bg-gradient-to-r from-violet-500/10 via-violet-500/25 to-violet-400/45',
          )}
          style={{
            width: `calc(${trackProgress * 100}% + ${HANDLE / 2}px)`,
            transition: dragging ? 'none' : 'width 260ms cubic-bezier(.22,1,.36,1)',
          }}
        >
          {/* 尾部流光，强化"拖尾"观感 */}
          {trackProgress > 0.02 && !done && (
            <span
              className="absolute inset-y-0 right-0 w-10 animate-pulse-soft"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(167,139,250,.55))',
                filter: 'blur(6px)',
                opacity: dragging ? 0.9 : 0.4,
              }}
            />
          )}
        </div>

        {/* 文案 */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {loading ? (
            <span className="flex items-center gap-1.5 text-[12px] text-slate-400">
              <Loader2 className="size-3.5 animate-spin" /> 正在加载验证…
            </span>
          ) : error && !challengeId ? (
            <span className="flex items-center gap-1.5 text-[12px] text-rose-300">
              <RotateCw className="size-3.5" /> 加载失败
            </span>
          ) : done ? (
            <span className="flex items-center gap-1.5 text-[12px] text-emerald-200">
              <Check className="size-3.5" /> 验证通过
            </span>
          ) : status === 'checking' ? (
            <span className="flex items-center gap-1.5 text-[12px] text-violet-200">
              <Loader2 className="size-3.5 animate-spin" /> 正在校验…
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[12px] text-slate-500">
              <ShieldCheck className="size-3.5" /> 按住滑块，拖动到最右端
            </span>
          )}
        </div>

        {/* 手柄 / 重试按钮 */}
        {!loading && !challengeId ? (
          <button
            type="button"
            onClick={() => setRetry((v) => v + 1)}
            disabled={disabled}
            className="absolute top-1/2 left-1 z-10 flex h-9 -translate-y-1/2 items-center gap-1 rounded-lg border border-rose-300/40 bg-rose-500/20 px-2.5 text-[11px] text-rose-100 transition hover:bg-rose-500/30 disabled:opacity-50"
          >
            <RotateCw className="size-3" /> 重试
          </button>
        ) : (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={cn(
              'absolute top-1/2 z-10 grid place-items-center rounded-lg border text-white',
              done
                ? 'border-emerald-300/50 bg-emerald-400/90'
                : status === 'fail'
                  ? 'border-rose-300/50 bg-rose-400/90'
                  : 'cursor-grab border-white/20 bg-gradient-to-br from-violet-500 to-indigo-600 shadow-[0_6px_18px_-6px_rgba(139,92,246,.9)] active:cursor-grabbing',
              dragging && 'cursor-grabbing',
            )}
            style={{
              width: HANDLE,
              height: HANDLE,
              top: '50%',
              transform: 'translateY(-50%)',
              left: `calc(${trackProgress * 100}% - ${trackProgress * HANDLE}px + 4px)`,
              transition: dragging ? 'none' : 'left 260ms cubic-bezier(.22,1,.36,1)',
            }}
          >
            {done ? (
              <Check className="size-4" />
            ) : status === 'checking' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ChevronRight className="size-5" />
            )}
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-2 text-[11px]">
        <span className={cn('flex items-center gap-1', status === 'fail' || (error && !challengeId) ? 'text-rose-300' : 'text-slate-500')}>
          {error && !challengeId ? `验证加载失败：${error}` : '用于防止机器批量注册'}
        </span>
        <button
          type="button"
          onClick={() => setRetry((v) => v + 1)}
          disabled={disabled || loading || done}
          className="flex shrink-0 items-center gap-1 text-slate-500 transition hover:text-slate-200 disabled:opacity-40"
        >
          <RotateCw className="size-3" /> 刷新
        </button>
      </div>
    </div>
  );
}
