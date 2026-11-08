import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

/**
 * 全局登录过期提示
 *
 * 监听 api 层派发的 qm:session-expired 事件，
 * 统一弹出「登录过期，请重新登录」并跳转登录页。
 *
 * 这样做的好处：无论用户在哪个页面、触发哪个接口，
 * 过期提示都一致，不会出现「某些页面静默失败」的情况。
 */
export function SessionExpiredGuard() {
  const navigate = useNavigate();

  useEffect(() => {
    let shown = false;

    const onExpired = (e: Event) => {
      // 防止并发请求同时过期时弹多次
      if (shown) return;
      shown = true;

      const detail = (e as CustomEvent)?.detail || {};
      const reasonText: Record<string, string> = {
        idle: '长时间未操作',
        expired: '登录已到期',
        kicked: '已被管理员下线',
        'role-changed': '权限已变更',
        disabled: '账号状态异常',
      };
      const why = reasonText[detail.reason] || '';

      toast.error('登录过期，请重新登录', {
        description: why ? `原因：${why}` : undefined,
        duration: 5000,
      });

      // 清理本地用户态并跳转
      setTimeout(() => {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        navigate(`/login?redirect=${redirect}`, { replace: true });
        shown = false;
      }, 800);
    };

    window.addEventListener('qm:session-expired', onExpired);
    return () => window.removeEventListener('qm:session-expired', onExpired);
  }, [navigate]);

  return null;
}
