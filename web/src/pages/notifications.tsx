import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Bell,
  BellRing,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Info,
  Megaphone,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type Notification } from '@/lib/api';
import { useNotifications } from '@/lib/notifications';
import { cn, relativeTime, formatDate } from '@/lib/utils';

const LEVEL_STYLE: Record<string, { dot: string; icon: any; tone: string }> = {
  info: { dot: 'bg-sky-400', icon: Info, tone: 'border-sky-300/20 bg-sky-400/[0.07] text-sky-200' },
  success: { dot: 'bg-emerald-400', icon: ShieldCheck, tone: 'border-emerald-300/20 bg-emerald-400/[0.07] text-emerald-200' },
  warning: { dot: 'bg-amber-400', icon: TriangleAlert, tone: 'border-amber-300/20 bg-amber-400/[0.07] text-amber-200' },
  danger: { dot: 'bg-rose-400', icon: TriangleAlert, tone: 'border-rose-300/20 bg-rose-400/[0.07] text-rose-200' },
};

const FILTERS = [
  { key: 'all', label: '全部', icon: Bell },
  { key: 'personal', label: '个人通知', icon: UserRound },
  { key: 'system', label: '系统通知', icon: Megaphone },
  { key: 'review', label: '审核结果', icon: ShieldCheck },
  { key: 'appeal', label: '申诉进度', icon: Sparkles },
];

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { setUnread, refresh } = useNotifications();
  const [category, setCategory] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Notification[]; total: number; pages: number; unread: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Notification | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: Notification[]; total: number; pages: number; unread: number }>(
        `/notifications?category=${category}&unreadOnly=${unreadOnly}&page=${page}&pageSize=12`,
      );
      setData(res);
      setUnread(res.unread);
    } catch {
      setData({ items: [], total: 0, pages: 1, unread: 0 });
    } finally {
      setLoading(false);
    }
  }, [category, unreadOnly, page, setUnread]);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (n: Notification) => {
    setDetail(n);
    if (!n.readAt) {
      try {
        await api.post('/notifications/read', { ids: [n.id] });
        setData((d) =>
          d
            ? {
                ...d,
                unread: Math.max(0, d.unread - 1),
                items: d.items.map((i) => (i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i)),
              }
            : d,
        );
        refresh();
      } catch {
        /* ignore */
      }
    }
  };

  const readAll = async () => {
    try {
      await api.post('/notifications/read', { all: true });
      toast.success('已全部标记为已读');
      refresh();
      load();
    } catch {
      toast.error('操作失败');
    }
  };

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, Notification[]>();
    for (const n of data.items) {
      const key = formatDate(n.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }
    return [...map.entries()];
  }, [data]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] text-slate-500 uppercase">
            <BellRing className="size-3 text-violet-300" /> Notifications
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white">通知中心</h1>
          <p className="mt-1 text-[12.5px] text-slate-500">
            个人通知与系统公告都会汇总在这里，未读通知会在导航栏显示红点。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={unreadOnly ? 'default' : 'secondary'} size="sm" onClick={() => { setUnreadOnly((v) => !v); setPage(1); }}>
            <Inbox className="size-3.5" /> 仅看未读
          </Button>
          <Button variant="secondary" size="sm" onClick={readAll}>
            <CheckCheck className="size-3.5" /> 全部已读
          </Button>
        </div>
      </div>

      <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setCategory(f.key);
              setPage(1);
            }}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] transition',
              category === f.key
                ? 'border-violet-300/40 bg-violet-400/15 text-violet-100'
                : 'border-white/8 bg-white/[0.03] text-slate-400 hover:border-white/16 hover:text-slate-200',
            )}
          >
            <f.icon className="size-3.5" />
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="glass flex flex-col items-center gap-4 rounded-3xl px-6 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <Inbox className="size-6 text-slate-400" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-medium text-white">{unreadOnly ? '没有未读通知' : '暂时没有通知'}</h3>
            <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-slate-500">
              审核结果、申诉进度与系统公告会出现在这里。
            </p>
          </div>
          <Button variant="secondary" asChild>
            <a href="/">返回圈名广场</a>
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([date, list]) => (
            <div key={date}>
              <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-500">
                <span>{date}</span>
                <span className="hairline flex-1" />
                <span>{list.length} 条</span>
              </div>
              <div className="space-y-2">
                {list.map((n) => {
                  const style = LEVEL_STYLE[n.level] || LEVEL_STYLE.info;
                  const Icon = style.icon;
                  return (
                    <button
                      key={n.id}
                      onClick={() => open(n)}
                      className={cn(
                        'glass-soft flex w-full items-start gap-3 rounded-2xl p-4 text-left transition hover:border-white/18 hover:bg-white/[0.06]',
                        !n.readAt && 'border-violet-300/20 bg-violet-400/[0.05]',
                      )}
                    >
                      <div className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border', style.tone)}>
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('text-[13.5px]', n.readAt ? 'text-slate-300' : 'font-medium text-white')}>
                            {n.title}
                          </span>
                          {!n.readAt && <span className={cn('size-1.5 rounded-full', style.dot)} />}
                          <Badge variant={n.type === 'system' ? 'secondary' : 'default'} className="px-1.5 py-0 text-[9.5px]">
                            {n.type === 'system' ? '系统' : '个人'}
                          </Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-slate-400">{n.content}</p>
                        <div className="mt-1.5 text-[10.5px] text-slate-600">{relativeTime(n.createdAt)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {data.pages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="secondary" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-[12px] text-slate-400">
                {page} / {data.pages}
              </span>
              <Button variant="secondary" size="icon" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 详情 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={() => setDetail(null)} />
          <div className="glass-strong relative z-10 w-full max-w-lg rounded-3xl p-6 animate-rise">
            <div className="flex items-start gap-3">
              <div className={cn('grid size-10 shrink-0 place-items-center rounded-xl border', (LEVEL_STYLE[detail.level] || LEVEL_STYLE.info).tone)}>
                {(() => {
                  const Icon = (LEVEL_STYLE[detail.level] || LEVEL_STYLE.info).icon;
                  return <Icon className="size-4" />;
                })()}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-white">{detail.title}</h3>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                  <span>{detail.type === 'system' ? '系统通知' : '个人通知'}</span>
                  <span>·</span>
                  <span>{formatDate(detail.createdAt, true)}</span>
                </div>
              </div>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-300">{detail.content}</p>
            <div className="mt-6 flex justify-end gap-2">
              {detail.link && (
                <Button
                  onClick={() => {
                    setDetail(null);
                    navigate(detail.link!);
                  }}
                >
                  前往查看
                </Button>
              )}
              <Button variant="secondary" onClick={() => setDetail(null)}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
