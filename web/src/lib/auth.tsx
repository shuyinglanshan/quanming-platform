import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, type User } from './api';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  mailConfigured: boolean | null;
  refresh: () => Promise<User | null>;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  isStaff: boolean;
  isAdmin: boolean;
};

const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['review', 'appeal', 'users', 'names', 'logs', 'settings', 'notify', 'dashboard'],
  assessor: ['review', 'appeal', 'dashboard', 'logs'],
  user: [],
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  mailConfigured: null,
  refresh: async () => null,
  setUser: () => {},
  logout: async () => {},
  can: () => false,
  isStaff: false,
  isAdmin: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mailConfigured, setMailConfigured] = useState<boolean | null>(null);

  /**
   * 恢复登录态
   *
   * 关键改动：加入超时兜底
   *   旧实现如果 /auth/me 因网络/服务问题一直挂起，
   *   loading 永远是 true，页面会卡在「正在验证登录状态…」。
   *   现在无论成功失败，最多 8 秒内必定结束 loading。
   */
  const refresh = useCallback(async () => {
    let settled = false;
    const finish = (u: User | null) => {
      if (settled) return;
      settled = true;
      setUser(u);
      setLoading(false);
      // 放行后续请求，避免刷新瞬间误报「会话校验失败」
      import('./crypto').then((m) => m.markSidReady());
    };

    // 超时保护：8 秒未返回则视为未登录
    const timer = window.setTimeout(() => {
      if (!settled) {
        console.warn('[auth] 恢复登录态超时，按未登录处理');
        finish(null);
      }
    }, 8000);

    try {
      const data = await api.get<{
        user: User | null;
        mailConfigured: boolean;
        sessionId?: string | null;
      }>('/auth/me');
      window.clearTimeout(timer);
      setMailConfigured(data.mailConfigured);
      // 已登录则启动心跳
      if (data.user) {
        import('./heartbeat').then((m) => m.startHeartbeat());
      }
      finish(data.user);
      return data.user;
    } catch {
      window.clearTimeout(timer);
      finish(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    const { stopHeartbeat } = await import('./heartbeat');
    stopHeartbeat();
    setUser(null);
  }, []);

  const can = useCallback(
    (permission: string) => {
      if (!user) return false;
      const perms = user.permissions?.length ? user.permissions : ROLE_PERMISSIONS[user.role] || [];
      return perms.includes(permission);
    },
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      mailConfigured,
      refresh,
      setUser,
      logout,
      can,
      isStaff: user?.role === 'admin' || user?.role === 'assessor',
      isAdmin: user?.role === 'admin',
    }),
    [user, loading, mailConfigured, refresh, logout, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export { ROLE_PERMISSIONS };
