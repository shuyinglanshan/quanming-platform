import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Activity, Ban, Clock3, Globe2, Loader2, MapPin, ShieldAlert, ShieldCheck,
  Unlock, User as UserIcon, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api';
import { cn, formatDate, relativeTime } from '@/lib/utils';

type LogDetail = {
  log: {
    id: string; ts: number; ip: string; method: string; path: string;
    status: number; ms: number; action: string; email?: string | null;
    detail?: string; level?: string; ua?: string; browser?: string;
    os?: string; device?: string; geo?: string; geoKind?: string; isPrivate?: boolean;
  };
  ip: {
    ip: string; region: string; kind: string; isPrivate: boolean; isIpv6: boolean;
    blocked: boolean; blockReason?: string; blockedAt?: string | null;
    tempBlocked: boolean; tempUntil?: number | null; tempReason?: string;
  };
  sameIp: { id: string; ts: number; method: string; path: string; status: number; ms: number; action: string }[];
  sameIpStats: { total: number; last1h: number; errors: number; rateLimited: number; firstSeen: number | null; lastSeen: number | null };
};

const PRESETS = [
  { label: '10 分钟', seconds: 600 },
  { label: '1 小时', seconds: 3600 },
  { label: '24 小时', seconds: 86400 },
];

export function IpDetailDialog({
  logId,
  ip,
  open,
  onOpenChange,
  onChanged,
}: {
  logId?: string | null;
  ip?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<LogDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [mode, setMode] = useState<'temp' | 'permanent'>('temp');
  const [seconds, setSeconds] = useState(3600);
  const [reason, setReason] = useState('管理员手动限制');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setData(null);
    const url = logId ? `/admin/logs/${logId}` : `/admin/ip/${encodeURIComponent(ip || '')}/profile`;
    api
      .get<any>(url)
      .then((r) => {
        // ip/profile 返回结构略有差异，统一成 LogDetail 形状
        if (r.log) setData(r as LogDetail);
        else {
          setData({
            log: {
              id: '', ts: r.recent?.[0]?.ts || Date.now(), ip: r.ip.ip, method: '', path: '',
              status: 0, ms: 0, action: '', geo: r.ip.region,
            },
            ip: r.ip,
            sameIp: r.recent || [],
            sameIpStats: r.stats,
          } as any);
        }
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [open, logId, ip]);

  const doBlock = async () => {
    if (!data) return;
    setActing(true);
    try {
      await api.post('/admin/security/block', {
        ip: data.ip.ip,
        reason,
        seconds: mode === 'temp' ? seconds : undefined,
      });
      toast.success(mode === 'temp' ? `已临时限制 ${Math.round(seconds / 60)} 分钟` : '已永久拉黑该 IP');
      const r = await api.get<any>(logId ? `/admin/logs/${logId}` : `/admin/ip/${encodeURIComponent(data.ip.ip)}/profile`);
      if (r.log) setData(r);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing(false);
    }
  };

  const doUnblock = async () => {
    if (!data) return;
    setActing(true);
    try {
      await api.post('/admin/security/unblock', { ip: data.ip.ip });
      toast.success('已解除限制');
      const r = await api.get<any>(logId ? `/admin/logs/${logId}` : `/admin/ip/${encodeURIComponent(data.ip.ip)}/profile`);
      if (r.log) setData(r);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing(false);
    }
  };

  const s = data?.sameIpStats;
  const blocked = data?.ip.blocked;
  const tempBlocked = data?.ip.tempBlocked;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-[15px]">
            <Globe2 className="size-4 text-violet-300" />
            访问详情
            {data && (
              <Badge variant={blocked ? 'danger' : tempBlocked ? 'warning' : 'success'} className="text-[10px]">
                {blocked ? '已永久拉黑' : tempBlocked ? '临时限制中' : '状态正常'}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="break-all font-mono text-[12px]">
            {data?.ip.ip || ip || '—'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-slate-400">
            <Loader2 className="size-4 animate-spin" /> 加载中…
          </div>
        ) : !data ? (
          <div className="py-10 text-center text-[13px] text-slate-400">加载失败</div>
        ) : (
          <div className="space-y-3">
            {/* 归属地 */}
            <div className="rounded-xl border border-white/8 bg-white/[0.04] p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                <MapPin className="size-3" /> IP 归属地
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium text-white">{data.ip.region}</span>
                {data.ip.isPrivate && <Badge variant="warning" className="text-[9.5px]">内网 / 特殊段</Badge>}
                {data.ip.isIpv6 && <Badge variant="secondary" className="text-[9.5px]">IPv6</Badge>}
              </div>
            </div>

            {/* 本次请求 */}
            {data.log.id && (
              <div className="rounded-xl border border-white/8 bg-white/[0.04] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Activity className="size-3" /> 本次请求
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { k: '时间', v: formatDate(new Date(data.log.ts).toISOString(), true) },
                    { k: '响应', v: `${data.log.status} · ${data.log.ms}ms` },
                    { k: '方法', v: data.log.method || '—' },
                    { k: '操作', v: data.log.action || '—' },
                  ].map((i) => (
                    <div key={i.k} className="min-w-0">
                      <div className="text-[10.5px] text-slate-500">{i.k}</div>
                      <div className="break-all text-[12px] text-slate-200">{i.v}</div>
                    </div>
                  ))}
                  <div className="min-w-0 sm:col-span-2">
                    <div className="text-[10.5px] text-slate-500">路径</div>
                    <div className="break-all font-mono text-[11.5px] text-slate-200">{data.log.path || '—'}</div>
                  </div>
                  {data.log.email && (
                    <div className="min-w-0">
                      <div className="text-[10.5px] text-slate-500">账号</div>
                      <div className="break-all text-[12px] text-slate-200">{data.log.email}</div>
                    </div>
                  )}
                  {data.log.detail && (
                    <div className="min-w-0 sm:col-span-2">
                      <div className="text-[10.5px] text-slate-500">详情</div>
                      <div className="break-all text-[12px] text-slate-300">{data.log.detail}</div>
                    </div>
                  )}
                  <div className="min-w-0 sm:col-span-2">
                    <div className="text-[10.5px] text-slate-500">客户端</div>
                    <div className="break-all text-[11.5px] text-slate-300">
                      {[data.log.browser, data.log.os, data.log.device].filter(Boolean).join(' · ') || '—'}
                    </div>
                    {data.log.ua && <div className="mt-0.5 break-all text-[10px] text-slate-600">{data.log.ua}</div>}
                  </div>
                </div>
              </div>
            )}

            {/* 该 IP 统计 */}
            <div className="rounded-xl border border-white/8 bg-white/[0.04] p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                <Zap className="size-3" /> 该 IP 访问统计
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { k: '总请求', v: s?.total ?? 0, tone: 'text-white' },
                  { k: '近 1 小时', v: s?.last1h ?? 0, tone: 'text-violet-200' },
                  { k: '异常响应', v: s?.errors ?? 0, tone: 'text-rose-200' },
                  { k: '被限流', v: s?.rateLimited ?? 0, tone: 'text-amber-200' },
                ].map((i) => (
                  <div key={i.k} className="rounded-lg border border-white/6 bg-white/[0.03] px-2 py-1.5">
                    <div className="text-[10px] text-slate-500">{i.k}</div>
                    <div className={cn('text-[15px] font-semibold tabular-nums', i.tone)}>{i.v}</div>
                  </div>
                ))}
              </div>
              {s?.firstSeen && (
                <div className="mt-2 flex flex-wrap gap-x-3 text-[10.5px] text-slate-500">
                  <span>首次访问 {formatDate(new Date(s.firstSeen).toISOString(), true)}</span>
                  <span>最近访问 {relativeTime(new Date(s.lastSeen || s.firstSeen).toISOString())}</span>
                </div>
              )}
            </div>

            {/* 近期行为 */}
            {data.sameIp.length > 0 && (
              <div className="rounded-xl border border-white/8 bg-white/[0.04] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Clock3 className="size-3" /> 近期请求（最多 20 条）
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {data.sameIp.map((l) => (
                    <div key={l.id} className="flex items-center gap-2 text-[11px]">
                      <span className={cn(
                        'shrink-0 rounded px-1 tabular-nums',
                        l.status >= 500 ? 'bg-rose-400/15 text-rose-200'
                          : l.status === 429 ? 'bg-amber-400/15 text-amber-200'
                          : l.status >= 400 ? 'bg-orange-400/15 text-orange-200'
                          : 'bg-emerald-400/12 text-emerald-200',
                      )}>{l.status}</span>
                      <span className="shrink-0 font-mono text-[10px] text-slate-500">{l.method}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-300">{l.action || l.path}</span>
                      <span className="shrink-0 text-[10px] text-slate-600">{relativeTime(new Date(l.ts).toISOString())}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 处置 */}
            <div className="rounded-xl border border-white/8 bg-white/[0.04] p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                <ShieldAlert className="size-3" /> 访问限制
              </div>

              {blocked || tempBlocked ? (
                <div className="space-y-2">
                  <div className={cn(
                    'rounded-lg border p-2.5 text-[11.5px]',
                    blocked ? 'border-rose-300/25 bg-rose-400/8 text-rose-200' : 'border-amber-300/25 bg-amber-400/8 text-amber-200',
                  )}>
                    <div className="font-medium">{blocked ? '该 IP 已被永久拉黑' : '该 IP 处于临时限制中'}</div>
                    <div className="mt-0.5 text-[10.5px] opacity-80">
                      {blocked ? data.ip.blockReason : data.ip.tempReason}
                      {tempBlocked && data.ip.tempUntil && ` · 解除于 ${formatDate(new Date(data.ip.tempUntil).toISOString(), true)}`}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" className="w-full" onClick={doUnblock} disabled={acting}>
                    {acting ? <Loader2 className="size-3.5 animate-spin" /> : <Unlock className="size-3.5" />} 解除限制
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant={mode === 'temp' ? 'default' : 'secondary'}
                      className="flex-1"
                      onClick={() => setMode('temp')}
                    >
                      <Clock3 className="size-3.5" /> 临时限制
                    </Button>
                    <Button
                      size="sm"
                      variant={mode === 'permanent' ? 'destructive' : 'secondary'}
                      className="flex-1"
                      onClick={() => setMode('permanent')}
                    >
                      <Ban className="size-3.5" /> 永久拉黑
                    </Button>
                  </div>

                  {mode === 'temp' && (
                    <div className="flex gap-1.5">
                      {PRESETS.map((pr) => (
                        <button
                          key={pr.seconds}
                          onClick={() => setSeconds(pr.seconds)}
                          className={cn(
                            'flex-1 rounded-lg border px-2 py-1.5 text-[11.5px] transition',
                            seconds === pr.seconds
                              ? 'border-violet-300/45 bg-violet-400/12 text-white'
                              : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20',
                          )}
                        >
                          {pr.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="ip-reason" className="text-[11px]">限制原因</Label>
                    <Input
                      id="ip-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value.slice(0, 60))}
                      placeholder="便于后续追溯"
                      className="h-8 text-[12px]"
                    />
                  </div>

                  <Button
                    size="sm"
                    variant={mode === 'permanent' ? 'destructive' : 'default'}
                    className="w-full"
                    onClick={doBlock}
                    disabled={acting}
                  >
                    {acting ? <Loader2 className="size-3.5 animate-spin" />
                      : mode === 'permanent' ? <Ban className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
                    {mode === 'permanent' ? '确认永久拉黑' : `限制 ${Math.round(seconds / 60)} 分钟`}
                  </Button>
                  {mode === 'permanent' && (
                    <p className="text-[10.5px] leading-relaxed text-rose-300/80">
                      永久拉黑后该 IP 将无法访问全站接口，请确认不是共享出口（如运营商 NAT、公司网络）。
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
