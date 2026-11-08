import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';

/**
 * 全局会话失效处理
 *
 * 职责：
 *   1. 监听 api 层派发的 qm:session-expired 事件
 *   2. **立即清空前端用户态**（这是修复「伪登录态」的关键）
 *   3. 提示「登录过期，请重新登录」
 *   4. 跳转登录页并带上回跳地址
 *
 * 为什么必须先清 user：
 *   旧实现只弹 toast、延迟 800ms 才跳转，期间 user 仍存在，
 *   RequireAuth 判定通过，页面继续渲染完整后台内容 —— 这就是
 *   「提示已过期，但界面显示已登录」的伪登录态。
 *
 * 处理的事件码：
 *   SESSION_EXPIRED       会话真的过期（闲置/被踢/角色变更/禁用）
 *   SESSION_ID_MISMATCH   SID 与服务端记录不符
 *   SESSION_ID_REQUIRED   请求缺少 SID 且会话已不可用
 */
export function SessionExpiredGuard() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();

  useEffect(() => {
    let handling = false;

    const onExpired = (e: Event) => {
      if (handling) return;
      handling = true;

      const detail = (e as CustomEvent)?.detail || {};
      const reasonText: Record<string, string> = {
        idle: '长时间未操作',
        expired: '登录已到期',
        kicked: '已被管理员下线',
        'role-changed': '权限已变更',
        disabled: '账号状态异常',
        invalid: '会话已失效',
      };
      const why = reasonText[detail.reason] || '';

      // 1) 关键：立刻清空用户态，避免界面继续显示「已登录」
      setUser(null);

      // 2) 提示
      toast.error('登录过期，请重新登录', {
        description: why ? `原因：${why}` : undefined,
        duration: 5000,
      });

      // 3) 跳转（保留当前地址作为回跳目标）
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      // 已在登录页则不重复跳转
      if (!window.location.pathname.startsWith('/login')) {
        navigate(`/login?redirect=${redirect}`, { replace: true });
      }

      // 允许后续（例如用户重新登录后再次过期）继续处理
      window.setTimeout(() => {
        handling = false;
      }, 1000);
    };

    window.addEventListener('qm:session-expired', onExpired);
    return () => window.removeEventListener('qm:session-expired', onExpired);
  }, [navigate, setUser]);

  // 额外保险：已登录用户若 SID 丢失（localStorage 被清），主动登出
  useEffect(() => {
    if (!user) return;
    // 页面可见时检查一次，避免用户切回来仍看到伪登录态
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      // 延迟检查，等 AuthProvider 完成恢复
      window.setTimeout(() => {
        const sid =
          sessionStorage.getItem('qm_sid') || localStorage.getItem('qm_sid_p') || '';
        if (!sid) setUser(null);
      }, 1500);
    };
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [user, setUser]);

  return null;
}
