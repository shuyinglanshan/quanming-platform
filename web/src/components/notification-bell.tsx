import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Inbox, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api, type Notification } from '@/lib/api';
import { useNotifications } from '@/lib/notifications';
import { cn, relativeTime } from '@/lib/utils';

const LEVEL_DOT: Record<string, string> = {
  info: 'bg-sky-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-rose-400',
};

export function NotificationBell() {
  const { unread, setUnread } = useNotifications();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: Notification[]; unreadAll: number }>('/notifications?pageSize=6');
      setItems(data.items);
      setUnread(data.unreadAll);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [setUnread]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const readAll = async () => {
    try {
      await api.post('/notifications/read', { all: true });
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
      setUnread(0);
      toast.success('已全部标记为已读');
    } catch {
      toast.error('操作失败');
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-slate-300 transition hover:bg-white/[0.09] hover:text-white"
        aria-label="通知"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-gradient-to-br from-rose-500 to-pink-600 px-1 text-[9.5px] font-medium text-white shadow">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className={cn(
              'glass-strong absolute top-[calc(100%+10px)] right-0 z-40 overflow-hidden rounded-2xl animate-rise',
              // 移动端自适应：不超出视口，避免横向溢出
              'w-[min(21rem,calc(100vw-2rem))]',
            )}>
            <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-medium text-white">通知</span>
                {unread > 0 && <span className="rounded-full bg-violet-400/15 px-1.5 py-0.5 text-[10px] text-violet-200">{unread} 未读</span>}
              </div>
              <button
                onClick={readAll}
                className="flex items-center gap-1 text-[11px] text-slate-400 transition hover:text-violet-200"
              >
                <CheckCheck className="size-3" /> 全部已读
              </button>
            </div>

            <div className="max-h-[22rem] overflow-y-auto p-1.5">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-slate-500">
                  <Loader2 className="size-3.5 animate-spin" /> 加载中…
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-[12px] text-slate-500">
                  <Inbox className="size-5" /> 暂无通知
                </div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      setOpen(false);
                      navigate('/notifications');
                    }}
                    className={cn(
                      'flex w-full gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-white/[0.07]',
                      !n.readAt && 'bg-white/[0.035]',
                    )}
                  >
                    <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', LEVEL_DOT[n.level] || 'bg-slate-400')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn('truncate text-[12.5px]', n.readAt ? 'text-slate-400' : 'font-medium text-white')}>
                          {n.title}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-500">{n.content}</p>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-600">
                        <span>{n.type === 'system' ? '系统通知' : '个人通知'}</span>
                        <span>·</span>
                        <span>{relativeTime(n.createdAt)}</span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-white/8 p-2">
              <Button variant="ghost" size="sm" className="w-full" asChild>
                <Link to="/notifications" onClick={() => setOpen(false)}>
                  查看全部通知
                </Link>
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
