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

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: User | null; mailConfigured: boolean }>('/auth/me');
      setUser(data.user);
      setMailConfigured(data.mailConfigured);
      return data.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
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
