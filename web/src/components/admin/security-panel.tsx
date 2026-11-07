import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Activity,
  Ban,
  Clock3,
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Unlock,
  Zap,
  UserPlus,
  Repeat,
  Save,
  Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IpDetailDialog } from './ip-detail-dialog';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api';
import { cn, formatDate, relativeTime } from '@/lib/utils';

type Config = {
  enabled: boolean;
  windowSeconds: number;
  maxRequests: number;
  tempBlockSeconds: number;
  strikesBeforeLongBlock: number;
  longBlockSeconds: number;
  whitelist: string[];
};

type Blocked = { ip: string; reason: string; createdAt: string; by?: string };
type TempBlock = { ip: string; reason: string; until: number; remainSeconds: number; strikes: number; blockCount?: number };
type Event = { id: string; type: string; ip: string; reason: string; level: string; createdAt: string; seconds?: number; strikes?: number };

type RegisterGuard = {
  enabled: boolean;
  windowMinutes: number;
  maxPerWindow: number;
  tempBlockMinutes: number;
  permBlockAfter: number;
};

type RegisterRow = { ip: string; recent: number; blocks: number; lastAt: number | null };

const EVENT_META: Record<string, { label: string; tone: string }> = {
  'rate-warn': { label: '频率提醒', tone: 'border-amber-300/25 bg-amber-400/10 text-amber-200' },
  'temp-block': { label: '临时拉黑', tone: 'border-orange-300/25 bg-orange-400/10 text-orange-200' },
  'perm-block': { label: '永久拉黑', tone: 'border-rose-300/25 bg-rose-400/10 text-rose-200' },
  unblock: { label: '解除限制', tone: 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200' },
};

export function SecurityPanel() {
  const [data, setData] = useState<{ config: Config; blockedIps: Blocked[]; tempBlocks: TempBlock[]; events: Event[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Config | null>(null);
  const [whitelistText, setWhitelistText] = useState('');
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockIp, setBlockIp] = useState('');
  const [blockReason, setBlockReason] = useState('异常高频请求');
  const [blockMode, setBlockMode] = useState<'permanent' | 'temp'>('permanent');
  const [blockSeconds, setBlockSeconds] = useState(60);
  const [acting, setActing] = useState(false);
  const [ipDetail, setIpDetail] = useState<string | null>(null);
  const [ipDetailOpen, setIpDetailOpen] = useState(false);
  // 系统健康（metrics + 日志完整性）：后端早已有接口，此前无展示入口
  const [health, setHealth] = useState<any>(null);
  const [integrity, setIntegrity] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const [m, i] = await Promise.all([
        api.get<any>('/admin/metrics'),
        api.get<any>('/admin/logs/integrity'),
      ]);
      setHealth(m);
      setIntegrity(i);
    } catch {
      /* 静默失败，避免影响风控主功能 */
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => { loadHealth(); }, [loadHealth]);

  const openIpDetail = (ip: string) => {
    setIpDetail(ip);
    setIpDetailOpen(true);
  };
  const [regGuard, setRegGuard] = useState<{ config: RegisterGuard; rows: RegisterRow[] } | null>(null);
  const [regForm, setRegForm] = useState<RegisterGuard | null>(null);
  const [bindLimit, setBindLimit] = useState(3);
  const [savingReg, setSavingReg] = useState(false);
  const [savingBind, setSavingBind] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [res, reg, bind] = await Promise.all([
        api.get<{ config: Config; blockedIps: Blocked[]; tempBlocks: TempBlock[]; events: Event[] }>('/admin/security'),
        api.get<{ config: RegisterGuard; rows: RegisterRow[] }>('/admin/register-guard').catch(() => null),
        api.get<{ monthlyLimit: number }>('/admin/binding-limit').catch(() => null),
      ]);
      setData(res);
      setForm(res.config);
      setWhitelistText(res.config.whitelist.join('\n'));
      if (reg) {
        setRegGuard(reg);
        setRegForm(reg.config);
      }
      if (bind) setBindLimit(bind.monthlyLimit);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 20000);
    return () => clearInterval(timer);
  }, [load]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const whitelist = whitelistText
        .split(/[\n,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api.put<{ config: Config }>('/admin/security/config', { ...form, whitelist });
      setForm(res.config);
      toast.success('风控配置已保存');
      load(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveRegGuard = async () => {
    if (!regForm) return;
    setSavingReg(true);
    try {
      await api.put('/admin/register-guard', regForm);
      toast.success('注册风控配置已保存');
      load(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSavingReg(false);
    }
  };

  const saveBindLimit = async () => {
    setSavingBind(true);
    try {
      await api.put('/admin/binding-limit', { monthlyLimit: bindLimit });
      toast.success('绑定修改限额已保存');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSavingBind(false);
    }
  };

  const block = async () => {
    if (!blockIp.trim()) return toast.error('请输入 IP 地址');
    setActing(true);
    try {
      await api.post('/admin/security/block', {
        ip: blockIp.trim(),
        reason: blockReason,
        seconds: blockMode === 'temp' ? blockSeconds : undefined,
      });
      toast.success(blockMode === 'temp' ? `已临时限制 ${blockSeconds} 秒` : '已永久拉黑该 IP');
      setBlockOpen(false);
      setBlockIp('');
      load(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing(false);
    }
  };

  const unblock = async (ip: string) => {
    try {
      await api.post('/admin/security/unblock', { ip });
      toast.success(`已解除 ${ip} 的限制`);
      load(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    }
  };

  const clearEvents = async () => {
    try {
      await api.del('/admin/security/events');
      toast.success('风控事件记录已清空');
      load(true);
    } catch {
      toast.error('清空失败');
    }
  };

  if (loading || !data || !form) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const stats = [
    { label: '风控状态', value: data.config.enabled ? '已开启' : '已关闭', icon: ShieldCheck, tone: data.config.enabled ? 'text-emerald-300' : 'text-slate-400' },
    { label: '临时限制中', value: data.tempBlocks.length, icon: Clock3, tone: 'text-amber-300' },
    { label: '永久黑名单', value: data.blockedIps.length, icon: Ban, tone: 'text-rose-300' },
    { label: '风控事件', value: data.events.length, icon: Activity, tone: 'text-cyan-300' },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-slate-400">{s.label}</span>
              <s.icon className={cn('size-4', s.tone)} />
            </div>
            <div className="mt-2 text-xl font-semibold text-white">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.05fr_1fr]">
        <div className="glass space-y-4 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="size-4 text-violet-200" />
              <h3 className="text-[13.5px] font-medium text-white">频繁请求检测</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500">{form.enabled ? '已开启' : '已关闭'}</span>
              <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            </div>
          </div>

          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[11.5px] leading-relaxed text-slate-400">
            <div className="flex items-start gap-2">
              <Zap className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
              <span>
                统计窗口内请求超过阈值时先返回 <span className="text-slate-200">429 提醒</span>（不封禁）；
                连续触发 <span className="text-slate-200">{form.strikesBeforeLongBlock}</span> 次才升级为临时拉黑，
                首次 <span className="text-slate-200">{form.tempBlockSeconds}s</span>，再次触发延长至{' '}
                <span className="text-slate-200">{form.longBlockSeconds}s</span>，避免误伤正常用户。
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sec-window">统计窗口（秒）</Label>
              <Input
                id="sec-window"
                value={form.windowSeconds}
                onChange={(e) => setForm({ ...form, windowSeconds: Number(e.target.value.replace(/\D/g, '')) || 1 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sec-max">窗口内最大请求</Label>
              <Input
                id="sec-max"
                value={form.maxRequests}
                onChange={(e) => setForm({ ...form, maxRequests: Number(e.target.value.replace(/\D/g, '')) || 10 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sec-strikes">升级拉黑阈值（次）</Label>
              <Input
                id="sec-strikes"
                value={form.strikesBeforeLongBlock}
                onChange={(e) => setForm({ ...form, strikesBeforeLongBlock: Number(e.target.value.replace(/\D/g, '')) || 1 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sec-temp">首次临时拉黑（秒）</Label>
              <Input
                id="sec-temp"
                value={form.tempBlockSeconds}
                onChange={(e) => setForm({ ...form, tempBlockSeconds: Number(e.target.value.replace(/\D/g, '')) || 5 })}
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="sec-long">重复触发拉黑时长（秒）</Label>
              <Input
                id="sec-long"
                value={form.longBlockSeconds}
                onChange={(e) => setForm({ ...form, longBlockSeconds: Number(e.target.value.replace(/\D/g, '')) || 30 })}
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="sec-white">IP 白名单（每行一个）</Label>
              <textarea
                id="sec-white"
                value={whitelistText}
                onChange={(e) => setWhitelistText(e.target.value)}
                rows={3}
                placeholder={'127.0.0.1\n::1'}
                className="w-full rounded-xl border border-white/12 bg-white/[0.045] px-3 py-2 font-mono text-[12px] text-slate-200 outline-none focus-visible:border-violet-400/50 focus-visible:ring-4 focus-visible:ring-violet-500/15"
              />
              <p className="text-[10.5px] text-slate-500">白名单内的 IP 不会触发任何频率限制。</p>
            </div>
          </div>

          <Button className="w-full" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} 保存风控配置
          </Button>
        </div>

        <div className="space-y-3">
          <div className="glass space-y-3 rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ban className="size-4 text-rose-200" />
                <h3 className="text-[13.5px] font-medium text-white">IP 限制名单</h3>
              </div>
              <div className="flex gap-1.5">
                <Button variant="secondary" size="sm" className="h-8" onClick={() => load(true)}>
                  <RefreshCw className="size-3" /> 刷新
                </Button>
                <Button size="sm" className="h-8" onClick={() => setBlockOpen(true)}>
                  <Plus className="size-3" /> 添加
                </Button>
              </div>
            </div>

            {data.tempBlocks.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-amber-200/80">
                  <Clock3 className="size-3" /> 临时限制中（{data.tempBlocks.length}）
                </div>
                <div className="space-y-1.5">
                  {data.tempBlocks.map((b) => (
                    <div key={b.ip} className="flex items-center gap-2 rounded-xl border border-amber-300/15 bg-amber-400/[0.06] px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() => openIpDetail(b.ip)}
                        className="shrink-0 rounded font-mono text-[12px] text-amber-100 underline decoration-dotted underline-offset-2 transition hover:text-white"
                      >
                        {b.ip}
                      </button>
                      <span className="text-[10.5px] text-amber-200/70">剩余 {b.remainSeconds}s</span>
                      <span className="ml-auto truncate text-[10px] text-amber-200/60">{b.reason}</span>
                      <Button variant="ghost" size="icon-sm" onClick={() => unblock(b.ip)} className="text-amber-200/80 hover:text-white">
                        <Unlock className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-rose-200/80">
                <ShieldOff className="size-3" /> 永久黑名单（{data.blockedIps.length}）
              </div>
              {data.blockedIps.length === 0 ? (
                <div className="rounded-xl border border-white/8 bg-white/[0.03] py-6 text-center text-[11.5px] text-slate-500">
                  暂无永久拉黑的 IP
                </div>
              ) : (
                <div className="max-h-52 space-y-1.5 overflow-y-auto pr-0.5">
                  {data.blockedIps.map((b) => (
                    <div key={b.ip} className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() => openIpDetail(b.ip)}
                        className="shrink-0 rounded font-mono text-[12px] text-slate-100 underline decoration-dotted underline-offset-2 transition hover:text-violet-200"
                      >
                        {b.ip}
                      </button>
                      <span className="truncate text-[10px] text-slate-500">{b.reason}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-slate-600">{formatDate(b.createdAt)}</span>
                      <Button variant="ghost" size="icon-sm" className="text-emerald-300/80 hover:text-emerald-200" onClick={() => unblock(b.ip)}>
                        <Unlock className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="glass space-y-4 rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="size-4 text-violet-200" />
                <h3 className="text-[13.5px] font-medium text-white">注册频率限制</h3>
              </div>
              {regForm && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">{regForm.enabled ? '已开启' : '已关闭'}</span>
                  <Switch checked={regForm.enabled} onCheckedChange={(v) => setRegForm({ ...regForm, enabled: v })} />
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[11.5px] leading-relaxed text-slate-400">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                <span>
                  同一 IP 在 <span className="text-slate-200">{regForm?.windowMinutes ?? 10}</span> 分钟内注册尝试超过{' '}
                  <span className="text-slate-200">{regForm?.maxPerWindow ?? 5}</span> 次时，先返回提示并临时封禁{' '}
                  <span className="text-slate-200">{regForm?.tempBlockMinutes ?? 30}</span> 分钟；
                  累计 <span className="text-slate-200">{regForm?.permBlockAfter ?? 3}</span> 次后自动永久拉黑。
                </span>
              </div>
            </div>

            {regForm && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="reg-window">统计窗口（分钟）</Label>
                  <Input
                    id="reg-window"
                    value={regForm.windowMinutes}
                    onChange={(e) => setRegForm({ ...regForm, windowMinutes: Number(e.target.value.replace(/\D/g, '')) || 1 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-max">窗口内最多注册尝试</Label>
                  <Input
                    id="reg-max"
                    value={regForm.maxPerWindow}
                    onChange={(e) => setRegForm({ ...regForm, maxPerWindow: Number(e.target.value.replace(/\D/g, '')) || 1 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-temp">临时封禁（分钟）</Label>
                  <Input
                    id="reg-temp"
                    value={regForm.tempBlockMinutes}
                    onChange={(e) => setRegForm({ ...regForm, tempBlockMinutes: Number(e.target.value.replace(/\D/g, '')) || 1 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-perm">永久拉黑阈值（次）</Label>
                  <Input
                    id="reg-perm"
                    value={regForm.permBlockAfter}
                    onChange={(e) => setRegForm({ ...regForm, permBlockAfter: Number(e.target.value.replace(/\D/g, '')) || 1 })}
                  />
                </div>
              </div>
            )}

            <Button className="w-full" size="sm" onClick={saveRegGuard} disabled={savingReg || !regForm}>
              {savingReg ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} 保存注册风控
            </Button>

            {regGuard && regGuard.rows.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] text-slate-500">近期注册尝试（按次数排序）</div>
                <div className="max-h-36 space-y-1 overflow-y-auto pr-0.5">
                  {regGuard.rows.slice(0, 8).map((r) => (
                    <div key={r.ip} className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1.5 text-[11px]">
                      <span className="font-mono text-slate-200">{r.ip}</span>
                      <span className="text-slate-500">{r.recent} 次</span>
                      {r.blocks > 0 && <Badge variant="warning" className="px-1 py-0 text-[9.5px]">已封禁 {r.blocks} 次</Badge>}
                      <span className="ml-auto text-slate-600">{r.lastAt ? relativeTime(r.lastAt) : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="glass space-y-3 rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <Repeat className="size-4 text-cyan-200" />
              <h3 className="text-[13.5px] font-medium text-white">社交绑定修改限额</h3>
            </div>
            <p className="text-[11.5px] leading-relaxed text-slate-400">
              每个用户每月可修改社交账号绑定的次数，首次绑定不占用额度；管理员代改不受此限制。
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="bind-limit">每月可修改次数</Label>
                <Input
                  id="bind-limit"
                  value={bindLimit}
                  onChange={(e) => setBindLimit(Number(e.target.value.replace(/\D/g, '')) || 1)}
                />
              </div>
              <Button size="sm" onClick={saveBindLimit} disabled={savingBind}>
                {savingBind ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 保存
              </Button>
            </div>
          </div>

          <div className="glass space-y-2 rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-cyan-200" />
                <h3 className="text-[13.5px] font-medium text-white">最近风控事件</h3>
              </div>
              {data.events.length > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={clearEvents}>
                  <Trash2 className="size-3" /> 清空
                </Button>
              )}
            </div>
            {data.events.length === 0 ? (
              <div className="rounded-xl border border-white/8 bg-white/[0.03] py-6 text-center text-[11.5px] text-slate-500">
                暂无风控事件
              </div>
            ) : (
              <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                {data.events.slice(0, 20).map((e) => {
                  const meta = EVENT_META[e.type] || { label: e.type, tone: 'border-white/15 bg-white/5 text-slate-300' };
                  return (
                    <div key={e.id} className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">
                      <span className={cn('shrink-0 rounded-full border px-1.5 py-0 text-[9.5px]', meta.tone)}>{meta.label}</span>
                      <span className="font-mono text-[11.5px] text-slate-200">{e.ip}</span>
                      <span className="truncate text-[10px] text-slate-500">{e.reason}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-slate-600">{relativeTime(e.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-rose-300" /> 限制 IP 访问
            </DialogTitle>
            <DialogDescription>永久拉黑会立即阻断该 IP 的所有接口请求；临时限制到期后自动解除。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="block-ip">IP 地址</Label>
              <Input id="block-ip" value={blockIp} onChange={(e) => setBlockIp(e.target.value.trim())} placeholder="例如 45.132.88.17" />
            </div>
            <div className="space-y-2">
              <Label>限制方式</Label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'permanent' as const, label: '永久拉黑', desc: '需手动解除' },
                  { key: 'temp' as const, label: '临时限制', desc: '到期自动恢复' },
                ].map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setBlockMode(m.key)}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-left transition',
                      blockMode === m.key ? 'border-violet-300/45 bg-violet-400/12' : 'border-white/8 bg-white/[0.03] hover:border-white/16',
                    )}
                  >
                    <div className="text-[12.5px] text-white">{m.label}</div>
                    <div className="text-[10.5px] text-slate-500">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            {blockMode === 'temp' && (
              <div className="space-y-2">
                <Label htmlFor="block-sec">限制时长（秒）</Label>
                <Input
                  id="block-sec"
                  value={blockSeconds}
                  onChange={(e) => setBlockSeconds(Number(e.target.value.replace(/\D/g, '')) || 60)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="block-reason">备注原因</Label>
              <Input id="block-reason" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBlockOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={block} disabled={acting}>
              {acting ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />} 确认限制
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 系统健康：进程指标 + 日志链完整性 */}
      <div className="glass rounded-2xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[13.5px] font-medium text-white">
            <Server className="size-4 text-cyan-300" /> 系统健康
          </h3>
          <Button size="sm" variant="secondary" onClick={loadHealth} disabled={healthLoading}>
            <RefreshCw className={cn('size-3.5', healthLoading && 'animate-spin')} /> 刷新
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { k: '运行时长', v: health ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m` : '—', tone: 'text-white' },
            { k: '内存占用', v: health ? `${Math.round(health.memory.rss / 1024 / 1024)} MB` : '—', tone: 'text-violet-200' },
            { k: '活动会话', v: health?.sessions ?? '—', tone: 'text-sky-200' },
            { k: '日志总条数', v: health?.db?.logs ?? '—', tone: 'text-slate-200' },
          ].map((i) => (
            <div key={i.k} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
              <div className="text-[10px] text-slate-500">{i.k}</div>
              <div className={cn('mt-0.5 text-[14px] font-semibold tabular-nums', i.tone)}>{i.v}</div>
            </div>
          ))}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-slate-500">日志链完整性：</span>
          {integrity ? (
            integrity.ok ? (
              <span className="flex items-center gap-1 rounded-md border border-emerald-300/25 bg-emerald-400/10 px-2 py-0.5 text-emerald-200">
                <ShieldCheck className="size-3" /> 校验通过（{integrity.total} 条）
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-md border border-rose-300/25 bg-rose-400/10 px-2 py-0.5 text-rose-200">
                <ShieldAlert className="size-3" /> 检测到篡改，断链于 {String(integrity.brokenAt).slice(0, 12)}
              </span>
            )
          ) : (
            <span className="text-slate-600">检测中…</span>
          )}
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-slate-500">
          日志采用哈希链式存储，任意一条被篡改都会导致后续校验失败，可用于审计取证。
        </p>
      </div>

      <IpDetailDialog
        open={ipDetailOpen}
        ip={ipDetail}
        onOpenChange={setIpDetailOpen}
        onChanged={() => load(true)}
      />
    </div>
  );
}
