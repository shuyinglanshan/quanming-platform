import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';

type Ctx = {
  unread: number;
  refresh: () => Promise<void>;
  setUnread: (n: number) => void;
};

const NotificationContext = createContext<Ctx>({ unread: 0, refresh: async () => {}, setUnread: () => {} });

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setUnread(0);
      return;
    }
    try {
      const data = await api.get<{ unread: number }>('/notifications/unread-count');
      setUnread(data.unread);
    } catch {
      /* ignore */
    }
  }, [user]);

  useEffect(() => {
    refresh();
    if (!user) return;
    timer.current = window.setInterval(refresh, 30000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [user, refresh]);

  const value = useMemo(() => ({ unread, refresh, setUnread }), [unread, refresh]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  return useContext(NotificationContext);
}
