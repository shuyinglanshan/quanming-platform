import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { ClickCaptcha, type ClickPayload } from '@/components/click-captcha';
import { cn } from '@/lib/utils';

/**
 * 极验 4.0 人机验证（GeeTest CAPTCHA v4）
 *
 * 官方前端接入流程：
 *   1. 引入 https://static.geetest.com/v4/gt4.js
 *   2. 用 captchaId 初始化 initGeetest4
 *   3. 用户完成验证后回调 onSuccess，拿到四个值
 *   4. 把四个值随业务请求提交，由服务端二次校验
 *
 * 本组件把这些封装起来：父组件只需调用 getPayload() 获取待提交的凭据，
 * 并在验证成功后自动拿到最新凭据。
 */

/** 极验验证凭据 */
export type GeetestPayload = {
  lot_number: string;
  captcha_output: string;
  pass_token: string;
  gen_time: string;
};

/** 兜底点击验证凭据 */
export type FallbackPayload = ClickPayload;

/** 统一凭据类型：极验 或 兜底点击 */
export type AnyCaptchaPayload = GeetestPayload | FallbackPayload;

type Status = 'loading' | 'ready' | 'unconfigured' | 'error' | 'fallback';

declare global {
  interface Window {
    initGeetest4?: (config: Record<string, unknown>, callback: (captcha: any) => void) => void;
  }
}

const SCRIPT_ID = 'geetest-gt4-script';
const SCRIPT_SRC = 'https://static.geetest.com/v4/gt4.js';

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.initGeetest4) return resolve();
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('极验脚本加载失败')));
      return;
    }
    const s = document.createElement('script');
    s.id = SCRIPT_ID;
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('极验脚本加载失败'));
    document.head.appendChild(s);
  });
}

export type GeetestHandle = {
  /** 取当前验证凭据（未通过时为 null） */
  getPayload: () => AnyCaptchaPayload | null;
  /** 主动弹出验证 */
  show: () => void;
  /** 是否已通过 */
  isPassed: () => boolean;
};

export const GeetestCaptcha = forwardRef<
  GeetestHandle,
  {
    /** 业务场景：注册与登录使用不同的验证应用 */
    scene: 'register' | 'login' | 'email';
    onPayload?: (payload: AnyCaptchaPayload | null) => void;
    onConfiguredChange?: (configured: boolean) => void;
    className?: string;
  }
>(function GeetestCaptcha({ scene, onPayload, onConfiguredChange, className }, ref) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [passed, setPassed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const captchaRef = useRef<any>(null);
  const payloadRef = useRef<AnyCaptchaPayload | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /** 供父组件在提交前取用 */
  const getPayload = useCallback(() => payloadRef.current, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const cfg = await api.get<{ configured: boolean; captchaId: string }>(
          `/auth/geetest/config?scene=${scene}`,
        );
        if (cancelled) return;
        onConfiguredChange?.(cfg.configured);

        // 未配置时不上报错误，由父组件决定如何提示
        if (!cfg.configured) {
          setStatus('unconfigured');
          return;
        }

        await loadScript();
        if (cancelled || !window.initGeetest4) {
          // 极验 SDK 未能初始化 → 兜底点击验证
          setStatus('fallback');
          return;
        }

        window.initGeetest4(
          {
            captchaId: cfg.captchaId,
            // 官方可选值：float（浮动）/ popup（弹出）/ bind（隐藏按钮）
            //
            // 选 bind：由我们自己的按钮触发 showCaptcha()，
            // 这样弹层的显示时机完全可控，且实测在 popup 模式下
            // 某些情况下弹层不显示（box_wrap 保持 display:none）。
            product: 'bind',
            language: 'zho',
            // 用户完成验证后自动关闭弹层
            hideBar: ['close'],
          },
          (captcha: any) => {
            if (cancelled) return;
            captchaRef.current = captcha;
            setStatus('ready');

            captcha
              .onSuccess(() => {
                const result = captcha.getValidate?.();
                if (result) {
                  payloadRef.current = {
                    lot_number: result.lot_number,
                    captcha_output: result.captcha_output,
                    pass_token: result.pass_token,
                    gen_time: result.gen_time,
                  };
                  setPassed(true);
                  onPayload?.(payloadRef.current);
                }
              })
              .onFail(() => {
                payloadRef.current = null;
                setPassed(false);
                onPayload?.(null);
              })
              .onError(() => {
                // 极验内部错误（服务不可达等）→ 切兜底
                payloadRef.current = null;
                setPassed(false);
                onPayload?.(null);
                setStatus('fallback');
              })
              .onClose(() => {
                payloadRef.current = null;
                setPassed(false);
                onPayload?.(null);
              });
          },
        );
      } catch (err) {
        if (cancelled) return;
        // 脚本加载失败 / 网络不可达 / CSP 拦截 → 兜底点击验证
        console.warn('[geetest] 加载失败，切换为点击验证:', err);
        setStatus('fallback');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scene, retryKey, onPayload, onConfiguredChange]);

  /**
   * 主动触发验证
   * 注意：官方文档说明 showCaptcha 仅对 product='bind' 有效，
   * popup 模式下需要重新初始化才能弹出，这里用 destroy + 重新挂载实现。
   */
  const show = useCallback(() => {
    if (passed) return;

    // 兜底计时：点击后若长时间既未通过、也未触发极验弹层，
    // 说明极验服务异常（域名不可达 / captchaId 失效），自动切点击验证
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (payloadRef.current) {
        window.clearInterval(timer);
        return;
      }
      if (Date.now() - startedAt > 8000) {
        window.clearInterval(timer);
        console.warn('[geetest] 验证超时未响应，切换为点击验证');
        setStatus('fallback');
      }
    }, 1000);

    // 正确做法：直接调用实例的 showCaptcha() 弹出验证层
    // （product=popup 同样支持；之前误判为只有 bind 可用，
    //   改成 destroy+重建反而导致弹层不显示）
    const inst = captchaRef.current;
    if (inst?.showCaptcha) {
      try {
        inst.showCaptcha();
        return;
      } catch (err) {
        console.warn('[geetest] showCaptcha 失败，尝试重建实例', err);
      }
    }
    // 兜底：实例不可用时重建
    try {
      inst?.destroy?.();
    } catch {
      /* 忽略 */
    }
    setRetryKey((k) => k + 1);
  }, [passed]);

  // 通过 ref 暴露给父组件（比挂静态属性更符合 React 规范）
  useImperativeHandle(
    ref,
    () => ({
      getPayload: () => payloadRef.current,
      show,
      isPassed: () => passed,
    }),
    [show, passed],
  );

  if (status === 'unconfigured') return null;

  if (status === 'loading') {
    return (
      <div className={cn('flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[11.5px] text-slate-400', className)}>
        <Loader2 className="size-3.5 animate-spin" /> 正在加载人机验证…
      </div>
    );
  }

  // 兜底：点击验证
  if (status === 'fallback') {
    return (
      <ClickCaptcha
        className={className}
        onPayload={(p) => {
          if (p) {
            payloadRef.current = p;
            setPassed(true);
            onPayload?.(p);
          } else {
            payloadRef.current = null;
            setPassed(false);
            onPayload?.(null);
          }
        }}
      />
    );
  }

  if (status === 'error') {
    return (
      <div className={cn('flex items-start gap-2 rounded-xl border border-rose-300/25 bg-rose-400/[0.08] px-3 py-2.5 text-[11.5px] text-rose-200', className)}>
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>人机验证加载失败：{error}。请刷新页面重试，或联系管理员。</span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <button
        type="button"
        onClick={show}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[12.5px] transition',
          passed
            ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-200'
            : 'border-white/12 bg-white/[0.04] text-slate-300 hover:border-violet-300/40 hover:text-white',
        )}
      >
        {passed ? (
          <>
            <ShieldCheck className="size-4" /> 人机验证已通过
          </>
        ) : (
          <>
            <ShieldCheck className="size-4" /> 点击完成人机验证
          </>
        )}
      </button>
      <div ref={containerRef} />
    </div>
  );
});
