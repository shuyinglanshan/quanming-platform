import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Activity,
  Clock3,
  Loader2,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api, ApiError } from '@/lib/api';
import { cn, relativeTime } from '@/lib/utils';

type SessionRow = {
  sessionId: string;
  userId: string;
  username: string;
  nickname: string;
  role: string;
  ip: string;
  ua: string;
  createdAt: number;
  lastActiveAt: number;
  lastHeartbeatAt: number;
  heartbeatAgo: number;
  expiresAt: number;
  current: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  admin: '管理员',
  superadmin: '超级管理员',
  assessor: '审核员',
  user: '普通用户',
};

/** 心跳状态：根据距今秒数判断 */
function heartbeatState(ago: number) {
  if (ago < 120) return { text: '活跃', tone: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200' };
  if (ago < 1800) return { text: '空闲', tone: 'border-sky-300/25 bg-sky-400/10 text-sky-200' };
  if (ago < 86400) return { text: '久未活动', tone: 'border-amber-300/25 bg-amber-400/10 text-amber-200' };
  return { text: '可能已离开', tone: 'border-rose-300/25 bg-rose-400/10 text-rose-200' };
}

function formatAgo(sec: number) {
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}

/**
 * 会话管理
 *
 * 展示所有活跃会话，含心跳状态。
 * 长时间未上报心跳的会话会被服务端自动踢出（默认 3 天），
 * 也可在此手动踢出。
 */
export function SessionsPanel() {
  const [data, setData] = useState<{ items: SessionRow[]; counts: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: SessionRow[]; counts: Record<string, number> }>('/admin/sessions');
      setData(res);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const kick = async (row: SessionRow) => {
    setActing(row.sessionId);
    try {
      await api.post(`/admin/sessions/${encodeURIComponent(row.sessionId)}/kick`);
      toast.success(`已踢出「${row.nickname}」的会话`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing('');
    }
  };

  const kickUser = async (row: SessionRow) => {
    setActing(`u-${row.userId}`);
    try {
      const res = await api.post<{ removed: number }>(
        `/admin/sessions/user/${encodeURIComponent(row.userId)}/kick`,
      );
      toast.success(`已踢出「${row.nickname}」的全部会话`, { description: `共 ${res.removed} 个` });
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing('');
    }
  };

  if (loading) {
    return (
      <div className="glass flex items-center justify-center gap-2 rounded-2xl py-14 text-[13px] text-slate-400">
        <Loader2 className="size-4 animate-spin" /> 正在加载会话…
      </div>
    );
  }

  const items = data?.items || [];

  return (
    <div className="space-y-4">
      {/* 概览 */}
      <div className="glass rounded-2xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[13.5px] font-medium text-white">
            <MonitorSmartphone className="size-4 text-cyan-300" /> 在线会话
          </h3>
          <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> 刷新
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { k: '总会话', v: data?.counts.total ?? 0 },
            { k: '管理员', v: data?.counts.admin ?? 0 },
            { k: '审核员', v: data?.counts.assessor ?? 0 },
            { k: '普通用户', v: data?.counts.user ?? 0 },
          ].map((i) => (
            <div key={i.k} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
              <div className="text-[10px] text-slate-500">{i.k}</div>
              <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-white">{i.v}</div>
            </div>
          ))}
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-slate-500">
          <Clock3 className="mt-0.5 size-3 shrink-0" />
          前端每 60 秒上报一次心跳；超过 3 天未上报的会话会被自动踢出并提示重新登录。
          用户 5 分钟无操作时暂停上报，避免「挂着页面」的会话永不过期。
        </p>
      </div>

      {/* 列表 */}
      {items.length === 0 ? (
        <div className="glass rounded-2xl py-14 text-center text-[13px] text-slate-400">暂无活跃会话</div>
      ) : (
        <div className="space-y-2">
          {items.map((row) => {
            const hb = heartbeatState(row.heartbeatAgo);
            return (
              <div
                key={row.sessionId}
                className={cn(
                  'glass-soft flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center',
                  row.current && 'border-violet-300/30',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-medium text-white">{row.nickname}</span>
                    <Badge variant="secondary" className="px-1.5 py-0 text-[9.5px]">
                      {ROLE_LABEL[row.role] || row.role}
                    </Badge>
                    {row.current && (
                      <Badge variant="success" className="px-1.5 py-0 text-[9.5px]">
                        当前会话
                      </Badge>
                    )}
                    <span className={cn('rounded-md border px-1.5 py-0 text-[9.5px]', hb.tone)}>{hb.text}</span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className="font-mono">{row.sessionId.slice(0, 14)}…</span>
                    <span className="size-1 rounded-full bg-slate-700" />
                    <span>IP {row.ip || '—'}</span>
                    <span className="size-1 rounded-full bg-slate-700" />
                    <span>心跳 {formatAgo(row.heartbeatAgo)}</span>
                    <span className="size-1 rounded-full bg-slate-700" />
                    <span>登录于 {relativeTime(new Date(row.createdAt).toISOString())}</span>
                  </div>

                  {row.ua && (
                    <div className="mt-1 truncate text-[10.5px] text-slate-600">{row.ua}</div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-rose-300 hover:text-rose-200"
                    disabled={acting !== '' || row.current}
                    title={row.current ? '不能踢出当前会话' : '踢出这个会话'}
                    onClick={() => kick(row)}
                  >
                    {acting === row.sessionId ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <LogOut className="size-3.5" />
                    )}
                    踢出
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-rose-300 hover:text-rose-200"
                    disabled={acting !== ''}
                    title="踢出该用户全部会话"
                    onClick={() => kickUser(row)}
                  >
                    {acting === `u-${row.userId}` ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <UserX className="size-3.5" />
                    )}
                    全部下线
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
