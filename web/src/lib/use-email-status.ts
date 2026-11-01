import { useEffect, useState } from 'react';
import { api } from './api';

/** 查询邮箱是否已注册（用于注册 / 登录页的实时提示） */
export function useEmailRegistered(email: string, enabled = true) {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const value = email.trim().toLowerCase();
    const at = value.indexOf('@');
    if (!enabled || at < 1 || !value.slice(at + 1)) {
      setRegistered(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.get<{ valid: boolean; registered: boolean }>(
          `/auth/email-check?email=${encodeURIComponent(value)}`,
        );
        if (!cancelled) setRegistered(data.valid ? data.registered : null);
      } catch {
        if (!cancelled) setRegistered(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 420);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [email, enabled]);

  return { registered, checking };
}
