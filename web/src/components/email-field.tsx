import { useEffect, useState } from 'react';
import { AtSign, BadgeCheck, CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useEmailRegistered } from '@/lib/use-email-status';

/** 通用邮箱规则：允许任意合法域名 */
export const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

/** 常见域名快捷建议 */
const SUGGEST_DOMAINS = ['qq.com', '163.com', '126.com', 'gmail.com', 'outlook.com', 'foxmail.com'];

/**
 * 邮箱输入框
 * 支持任意合法邮箱地址，不再限制 QQ 邮箱后缀；
 * 输入 @ 后展示常见域名快捷补全。
 */
export function EmailField({
  value,
  onChange,
  onValidChange,
  placeholder = '请输入邮箱地址',
  disabled,
  id = 'email',
  statusMode,
}: {
  value: string;
  onChange: (v: string) => void;
  onValidChange?: (info: { valid: boolean; email: string; domain: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** register：提示「该邮箱已注册」；login：提示「该邮箱尚未注册」 */
  statusMode?: 'register' | 'login';
}) {
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);

  const email = value.trim();
  const atIndex = email.indexOf('@');
  const localPart = atIndex === -1 ? email : email.slice(0, atIndex);
  const domainPart = atIndex === -1 ? '' : email.slice(atIndex + 1);

  const valid =
    EMAIL_RE.test(email) &&
    !email.endsWith('@') &&
    !email.includes('..') &&
    !/^[-.]|[-.]@|@-|@\./.test(email);

  const { registered, checking } = useEmailRegistered(email, Boolean(statusMode) && valid);

  useEffect(() => {
    onValidChange?.({ valid, email, domain: domainPart });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, email]);

  const showError = touched && email.length > 0 && !valid;
  // 正在输入域名时给出补全建议
  const showSuggest =
    focused && atIndex > 0 && domainPart.length > 0 && domainPart.length < 12 && !valid;

  const applyDomain = (d: string) => {
    onChange(`${localPart}@${d}`);
  };

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'group flex items-center rounded-xl border bg-white/[0.045] transition-all',
          focused && 'border-violet-400/50 bg-white/[0.07] ring-4 ring-violet-500/15',
          showError ? 'border-rose-400/40' : 'border-white/12',
          disabled && 'opacity-60',
        )}
      >
        <AtSign className="ml-3.5 size-4 shrink-0 text-slate-500" />
        <Input
          id={id}
          value={value}
          disabled={disabled}
          type="email"
          inputMode="email"
          autoComplete="email"
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setTouched(true);
          }}
          onChange={(e) => {
            setTouched(true);
            onChange(e.target.value.replace(/\s/g, '').slice(0, 254));
          }}
          placeholder={placeholder}
          className="h-11 border-0 bg-transparent px-2.5 shadow-none focus-visible:ring-0"
        />
      </div>

      {/* 域名快捷补全 */}
      {showSuggest && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGEST_DOMAINS.filter((d) => d.startsWith(domainPart.toLowerCase()))
            .slice(0, 4)
            .map((d) => (
              <button
                key={d}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyDomain(d)}
                className="rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] text-slate-300 transition hover:border-violet-300/40 hover:text-white"
              >
                @{d}
              </button>
            ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {valid ? (
          <span className="flex items-center gap-1 text-[11px] text-emerald-300">
            <BadgeCheck className="size-3" /> 邮箱格式正确
          </span>
        ) : (
          <span className={cn('flex items-center gap-1 text-[11px]', showError ? 'text-rose-300' : 'text-slate-500')}>
            {showError ? <CircleAlert className="size-3" /> : null}
            {showError ? '请输入完整的邮箱地址，例如 name@example.com' : '支持任意邮箱，如 QQ、网易、Gmail 等'}
          </span>
        )}
      </div>

      {statusMode && valid && (
        <p
          className={cn(
            'flex items-center gap-1.5 text-[11.5px]',
            checking
              ? 'text-slate-500'
              : statusMode === 'register'
                ? registered
                  ? 'text-amber-300'
                  : 'text-emerald-300'
                : registered
                  ? 'text-emerald-300'
                  : 'text-amber-300',
          )}
        >
          {checking ? (
            <>
              <Loader2 className="size-3 animate-spin" /> 正在查询邮箱状态…
            </>
          ) : registered === null ? (
            <span className="text-slate-500">输入完整邮箱后可自动识别注册状态</span>
          ) : statusMode === 'register' ? (
            registered ? (
              <>
                <CircleAlert className="size-3" /> 该邮箱已注册，请直接登录
              </>
            ) : (
              <>
                <CircleCheck className="size-3" /> 该邮箱可以注册
              </>
            )
          ) : registered ? (
            <>
              <CircleCheck className="size-3" /> 邮箱已注册，可以登录
            </>
          ) : (
            <>
              <CircleAlert className="size-3" /> 该邮箱尚未注册，请先注册账号
            </>
          )}
        </p>
      )}
    </div>
  );
}
