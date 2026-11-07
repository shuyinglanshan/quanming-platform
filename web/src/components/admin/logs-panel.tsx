import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Activity,
  CircleAlert,
  Globe2,
  Monitor,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Tablet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Pager } from './pager';
import { api, ApiError } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

type LogRow = {
  id: string;
  ts: number;
  ip: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  action: string;
  email: string | null;
  browser: string;
  os: string;
  device: string;
  level?: string;
  detail?: string;
};

const TABS = [
  { key: 'all', label: '全部记录' },
  { key: 'auth', label: '登录注册' },
  { key: 'review', label: '审核动作' },
  { key: 'security', label: '风控限制' },
  { key: 'error', label: '异常请求' },
];

function DeviceIcon({ device }: { device: string }) {
  if (device === '移动端') return <Smartphone className="size-3" />;
  if (device === '平板') return <Tablet className="size-3" />;
  return <Monitor className="size-3" />;
}

export function LogsPanel() {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: LogRow[]; total: number; pages: number; counts: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ level: tab, q, page: String(page), pageSize: '15' });
      const res = await api.get<any>(`/admin/logs?${params}`);
      setData(res);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tab, q, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [auto, load]);

  const methodTone = (m: string) => {
    switch (m) {
      case 'GET':
        return 'text-sky-300';
      case 'POST':
        return 'text-emerald-300';
      case 'PATCH':
      case 'PUT':
        return 'text-amber-300';
      case 'DELETE':
        return 'text-rose-300';
      default:
        return 'text-slate-300';
    }
  };

  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key);
                  setPage(1);
                }}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] whitespace-nowrap transition',
                  tab === t.key ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200',
                )}
              >
                <span className="whitespace-nowrap">{t.label}</span>
                {data?.counts && (
                  <span className={cn('shrink-0 rounded px-1 text-[10px] tabular-nums', tab === t.key ? 'bg-white/15 text-slate-100' : 'bg-white/5 text-slate-500')}>
                    {data.counts[t.key] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="搜索路径 / 邮箱 / IP / 动作"
              className="h-9 pl-8 text-[12.5px]"
            />
          </div>

          <button
            onClick={() => setAuto((v) => !v)}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[12px] transition',
              auto
                ? 'border-emerald-300/30 bg-emerald-400/12 text-emerald-200'
                : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-slate-200',
            )}
          >
            <span className={cn('size-1.5 rounded-full', auto ? 'animate-pulse bg-emerald-400' : 'bg-slate-600')} />
            {auto ? '实时刷新中' : '实时刷新'}
          </button>
          <Button variant="secondary" size="sm" className="h-9" onClick={load}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> 刷新
          </Button>
        </div>
      </div>

      <div className="glass overflow-hidden rounded-2xl">
        <div className="hidden grid-cols-[130px_1fr_150px_110px_80px] gap-3 border-b border-white/[0.07] px-4 py-2.5 text-[10.5px] tracking-wide text-slate-500 uppercase md:grid">
          <span>时间</span>
          <span>操作 / 路径</span>
          <span>访问者</span>
          <span>来源 IP</span>
          <span className="text-right">状态</span>
        </div>

        {loading && !data ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <div className="divide-y divide-white/[0.045]">
            {data.items.map((l) => {
              const bad = l.status >= 400 || l.level === 'error';
              return (
                <div
                  key={l.id}
                  className="grid grid-cols-1 gap-1.5 px-4 py-2.5 text-[12px] transition hover:bg-white/[0.03] md:grid-cols-[130px_1fr_150px_110px_80px] md:items-center md:gap-3"
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Activity className="size-3 text-slate-600 md:hidden" />
                    {formatDate(l.ts, true)}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('shrink-0 font-mono text-[10.5px]', methodTone(l.method))}>{l.method}</span>
                      <span className="truncate text-slate-200">{l.action}</span>
                      {l.status === 429 && (
                        <Badge variant="warning" className="px-1.5 py-0 text-[9.5px]">
                          限流
                        </Badge>
                      )}
                      {bad && l.status !== 429 && (
                        <Badge variant="danger" className="px-1.5 py-0 text-[9.5px]">
                          异常
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 truncate font-mono text-[10.5px] text-slate-600">
                      <Globe2 className="size-2.5 shrink-0" />
                      <span className="truncate">{l.path}</span>
                      {l.detail && <span className="ml-1 truncate text-slate-500">· {l.detail}</span>}
                    </div>
                  </div>

                  <div className="min-w-0 text-[11px] text-slate-400">
                    <div className="truncate">{l.email || '游客访问'}</div>
                    <div className="flex items-center gap-1 text-[10px] text-slate-600">
                      <DeviceIcon device={l.device} />
                      {l.browser} · {l.os}
                    </div>
                  </div>

                  <div className="font-mono text-[11px] text-slate-500">{l.ip}</div>

                  <div className="flex items-center gap-1.5 md:justify-end">
                    <span
                      className={cn(
                        'rounded-md border px-1.5 py-0 text-[10.5px]',
                        l.status === 429
                          ? 'border-amber-300/25 bg-amber-400/10 text-amber-200'
                          : bad
                          ? 'border-rose-300/25 bg-rose-400/10 text-rose-200'
                          : l.status >= 300
                            ? 'border-amber-300/25 bg-amber-400/10 text-amber-200'
                            : 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200',
                      )}
                    >
                      {l.status}
                    </span>
                    {l.ms > 0 && <span className="text-[10px] text-slate-600">{l.ms}ms</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <ShieldCheck className="size-6 text-slate-600" />
            <p className="text-[13px] text-slate-500">没有匹配的访问记录</p>
          </div>
        )}
      </div>

      {data && (
        <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />
      )}

      <div className="flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-500">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-slate-500" />
        访问日志保留最近 3000 条记录，包含请求路径、状态码、耗时、IP 与设备信息。敏感接口不会记录请求内容。
      </div>
    </div>
  );
}
