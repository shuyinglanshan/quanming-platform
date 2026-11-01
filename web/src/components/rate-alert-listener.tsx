import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { onRateAlert, type RateAlertDetail } from '@/lib/rate-alert';

/** 监听接口 429，统一弹出风控提醒（同一提示 8 秒内不重复弹出） */
export function RateAlertListener() {
  const last = useRef<{ at: number; message: string }>({ at: 0, message: '' });

  useEffect(() => {
    return onRateAlert((detail: RateAlertDetail) => {
      const now = Date.now();
      if (detail.message === last.current.message && now - last.current.at < 8000) return;
      last.current = { at: now, message: detail.message };

      const isBlocked = detail.code === 'IP_TEMP_BLOCKED' || detail.code === 'IP_BLOCKED';
      const remaining =
        detail.strikes !== undefined && detail.threshold !== undefined
          ? Math.max(0, detail.threshold - detail.strikes)
          : null;

      toast.warning(isBlocked ? '访问已被临时限制' : '请求过于频繁', {
        description:
          detail.message +
          (!isBlocked && remaining !== null ? `（再触发 ${remaining} 次将临时限制访问）` : '') +
          (detail.retryAfter ? ` · 约 ${detail.retryAfter} 秒后恢复` : ''),
        duration: 6000,
      });
    });
  }, []);

  return null;
}
