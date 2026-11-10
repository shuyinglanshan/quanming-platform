import { useEffect, useState } from 'react';
import { api } from './api';

type EmailCheckResult = {
  valid: boolean;
  /** 域名是否有 MX 记录、是否为一次性邮箱 */
  deliverable: boolean;
  label: string;
  reason: string;
};

/**
 * 邮箱输入实时校验
 *
 * 调用 /auth/email-check 做两件事：
 *   1. 格式校验（前端已做，服务端再确认）
 *   2. **可投递性校验**（MX 记录 + 一次性邮箱黑名单）
 *
 * 注意：该接口**不返回注册状态**（防账号枚举），
 * 因此这里只能提示「格式/域名是否可用」，不能提示「是否已注册」。
 */
export function useEmailStatus(email: string, enabled = true) {
  const [result, setResult] = useState<EmailCheckResult | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const value = email.trim().toLowerCase();
    const at = value.indexOf('@');
    if (!enabled || at < 1 || !value.slice(at + 1)) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.get<EmailCheckResult>(
          `/auth/email-check?email=${encodeURIComponent(value)}`,
        );
        if (!cancelled) setResult(data);
      } catch {
        if (!cancelled) setResult(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [email, enabled]);

  return { result, checking };
}

/** 兼容旧调用：仅关心是否可投递 */
export function useEmailRegistered(email: string, enabled = true) {
  const { result, checking } = useEmailStatus(email, enabled);
  return {
    // 不再提供注册状态，统一返回 null 避免误导
    registered: null as boolean | null,
    deliverable: result ? result.deliverable : null,
    reason: result?.reason || '',
    checking,
  };
}
