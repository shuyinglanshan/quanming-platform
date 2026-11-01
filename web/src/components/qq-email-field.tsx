import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CircleAlert, CircleCheck, Hash, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useEmailRegistered } from '@/lib/use-email-status';

/** QQ 号规则：5-11 位数字 */
export const QQ_NUMBER_RE = /^\d{5,11}$/;

/**
 * QQ 邮箱输入框
 * 后缀固定为 @qq.com，用户只需填写 QQ 号；对外仍抛出完整邮箱地址。
 */
export function QQEmailField({
  value,
  onChange,
  onDomain,
  placeholder = '请输入 QQ 号',
  disabled,
  id = 'email',
  statusMode,
}: {
  /** 完整邮箱，例如 123456789@qq.com */
  value: string;
  onChange: (v: string) => void;
  onDomain?: (info: { domain: string; valid: boolean }) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** register：提示「该邮箱已注册」；login：提示「该邮箱尚未注册」 */
  statusMode?: 'register' | 'login';
}) {
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);

  // 只保留 QQ 号部分（兼容历史值里带后缀的情况）
  const local = useMemo(() => {
    const at = value.indexOf('@');
    return (at === -1 ? value : value.slice(0, at)).replace(/\D/g, '').slice(0, 11);
  }, [value]);

  const valid = QQ_NUMBER_RE.test(local);
  const email = local ? `${local}@qq.com` : '';

  const { registered, checking } = useEmailRegistered(email, Boolean(statusMode) && valid);

  useEffect(() => {
    onDomain?.({ domain: 'qq.com', valid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid]);

  // 保证外部拿到的始终是「QQ号@qq.com」
  useEffect(() => {
    const expected = local ? `${local}@qq.com` : '';
    if (value !== expected) onChange(expected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  const handleChange = (raw: string) => {
    setTouched(true);
    onChange(raw.replace(/\D/g, '').slice(0, 11));
  };

  const showError = touched && local.length > 0 && !valid;

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
        <Hash className="ml-3.5 size-4 shrink-0 text-slate-500" />
        <Input
          id={id}
          value={local}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setTouched(true);
          }}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="username"
          inputMode="numeric"
          className="h-11 border-0 bg-transparent px-2.5 shadow-none focus-visible:ring-0"
        />
        <span className="mr-1.5 shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[12.5px] text-slate-300">
          @qq.com
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {valid ? (
          <span className="flex items-center gap-1 text-[11px] text-emerald-300">
            <BadgeCheck className="size-3" /> 将使用 {email}
          </span>
        ) : (
          <span className={cn('flex items-center gap-1 text-[11px]', showError ? 'text-rose-300' : 'text-slate-500')}>
            {showError ? <CircleAlert className="size-3" /> : null}
            {showError ? 'QQ 号需为 5-11 位数字' : '只需填写 QQ 号，邮箱后缀固定为 @qq.com'}
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
            <span className="text-slate-500">输入完整 QQ 号后可自动识别注册状态</span>
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
