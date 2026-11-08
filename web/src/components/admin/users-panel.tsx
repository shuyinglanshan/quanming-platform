import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Ban,
  CheckCircle2,
  Crown,
  Gavel,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  ShieldCheck,
  Scale,
  Trash2,
  UserCheck,
  UserCog,
  Users2,
  Link2,
  RotateCcw,
  Save,
  Award,
  KeyRound,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserAvatar } from '@/components/user-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pager } from './pager';
import { api, ApiError, type Role, type User } from '@/lib/api';
import { cn, formatDate, initials, relativeTime, statusTone, STATUS_TEXT, ROLE_META } from '@/lib/utils';

type Row = User & {
  courtPermission?: boolean;
  maskedEmail: string;
  lastIp: string;
  loginCount: number;
  names: string[];
  claimsTotal: number;
  appealsTotal: number;
};

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'admin', label: '管理员' },
  { value: 'superadmin', label: '超级管理员' },
  { value: 'assessor', label: '审核员' },
  { value: 'user', label: '普通用户' },
];

export function UsersPanel({ onChanged, currentUserId }: { onChanged?: () => void; currentUserId?: string }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [sort, setSort] = useState('latest');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Row[]; total: number; pages: number; counts: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Row | null>(null);
  const [banTarget, setBanTarget] = useState<Row | null>(null);
  const [banReason, setBanReason] = useState('违反平台规则');
  const [delTarget, setDelTarget] = useState<Row | null>(null);
  const [roleTarget, setRoleTarget] = useState<Row | null>(null);
  const [bindTarget, setBindTarget] = useState<Row | null>(null);
  const [bindForm, setBindForm] = useState<Record<string, string>>({ qq: '', wechat: '', xiaohongshu: '' });
  const [bindSaving, setBindSaving] = useState(false);
  const [titleTarget, setTitleTarget] = useState<Row | null>(null);
  const [titleValue, setTitleValue] = useState('');
  const [pwdTarget, setPwdTarget] = useState<Row | null>(null);
  const [pwdMode, setPwdMode] = useState<'random' | 'manual'>('random');
  const [pwdValue, setPwdValue] = useState('');
  const [resetResult, setResetResult] = useState<{ username: string; password: string } | null>(null);
  const [pwdResult, setPwdResult] = useState<{ username: string; password: string } | null>(null);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [roleValue, setRoleValue] = useState<Role>('user');
  const [selected, setSelected] = useState<string[]>([]);
  const [batchRole, setBatchRole] = useState<Role | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, status, role, sort, page: String(page), pageSize: '8' });
      const res = await api.get<any>(`/admin/users?${params}`);
      setData(res);
      setSelected([]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [q, status, role, sort, page]);

  useEffect(() => {
    load();
  }, [load]);

  const openBindEditor = (u: Row) => {
    setBindForm({
      qq: u.bindings?.qq?.handle || '',
      wechat: u.bindings?.wechat?.handle || '',
      xiaohongshu: u.bindings?.xiaohongshu?.handle || '',
    });
    setBindTarget(u);
  };

  const saveBindings = async () => {
    if (!bindTarget) return;
    setBindSaving(true);
    try {
      let changed = 0;
      for (const platform of ['qq', 'wechat', 'xiaohongshu'] as const) {
        const next = (bindForm[platform] || '').trim();
        const current = bindTarget.bindings?.[platform]?.handle || '';
        if (next === current) continue;
        await api.put(`/admin/users/${bindTarget.id}/bindings`, { platform, handle: next });
        changed += 1;
      }
      if (changed === 0) {
        toast.info('没有需要保存的修改');
      } else {
        toast.success(`已更新 ${changed} 项绑定`, { description: '用户会收到变更通知' });
      }
      setBindTarget(null);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setBindSaving(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>, successText: string) => {
    setActing(true);
    try {
      await api.patch(`/admin/users/${id}`, body);
      toast.success(successText);
      setBanTarget(null);
      setDetail(null);
      setRoleTarget(null);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing(false);
    }
  };

  const remove = async () => {
    if (!delTarget) return;
    setActing(true);
    try {
      await api.del(`/admin/users/${delTarget.id}`);
      toast.success('用户已删除，其名下圈名已下架');
      setDelTarget(null);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败');
    } finally {
      setActing(false);
    }
  };

  const applyBatch = async () => {
    if (!batchRole) return;
    setActing(true);
    try {
      const res = await api.post<{ done: number; skipped: number }>('/admin/users/roles', { ids: selected, role: batchRole });
      toast.success(`已调整 ${res.done} 位用户的权限组`, { description: res.skipped ? `跳过 ${res.skipped} 位` : undefined });
      setBatchRole(null);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing(false);
    }
  };

  const STATUS_TABS = [
    { key: 'all', label: '全部' },
    { key: 'active', label: '正常' },
    { key: 'banned', label: '已封禁' },
  ];

  const allChecked = Boolean(data?.items.length) && selected.length === data?.items.length;

  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setStatus(t.key);
                  setPage(1);
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition',
                  status === t.key ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200',
                )}
              >
                {t.label}
                {data?.counts && (
                  <span className={cn('rounded px-1 text-[10px]', status === t.key ? 'bg-white/15 text-slate-100' : 'bg-white/5 text-slate-500')}>
                    {data.counts[t.key] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>

          <Select value={role} onValueChange={(v) => { setRole(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部权限组</SelectItem>
              <SelectItem value="admin">管理员</SelectItem>
              <SelectItem value="superadmin">超级管理员</SelectItem>
              <SelectItem value="assessor">审核员</SelectItem>
              <SelectItem value="user">普通用户</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">最新注册</SelectItem>
              <SelectItem value="oldest">最早注册</SelectItem>
              <SelectItem value="active">最近活跃</SelectItem>
              <SelectItem value="claims">申请最多</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative ml-auto w-full sm:w-56">
            <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="搜索邮箱 / 昵称 / ID"
              className="h-9 pl-8 text-[12.5px]"
            />
          </div>
          <Button variant="secondary" size="sm" className="h-9" onClick={load}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> 刷新
          </Button>
        </div>

        {/* 权限组说明 */}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {(['admin', 'superadmin', 'assessor', 'user'] as Role[]).map((r) => (
            <div key={r} className="rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
              <div className="flex items-center gap-1.5">
                <span className={cn('rounded-full border px-1.5 py-0 text-[10px]', ROLE_META[r].tone)}>{ROLE_META[r].label}</span>
                <span className="ml-auto text-[10.5px] text-slate-500">
                  {data?.counts?.[r] ?? 0} 人
                </span>
              </div>
              <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">{ROLE_META[r].desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 批量操作栏 */}
      {selected.length > 0 && (
        <div className="glass flex flex-wrap items-center gap-2 rounded-2xl px-4 py-2.5">
          <span className="text-[12px] text-slate-300">已选择 {selected.length} 位用户</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {ROLE_OPTIONS.map((r) => (
              <Button key={r.value} size="sm" variant="secondary" className="h-8" onClick={() => { setBatchRole(r.value); }}>
                设为{r.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setSelected([])}>
              取消选择
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1 text-[11px] text-slate-500">
            <Checkbox
              checked={allChecked}
              onCheckedChange={(v) => setSelected(v ? data.items.map((u) => u.id) : [])}
            />
            <span>全选本页</span>
          </div>

          {data.items.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <div key={u.id} className="glass-soft flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 transition hover:border-white/16">
                <Checkbox
                  checked={selected.includes(u.id)}
                  disabled={isSelf}
                  onCheckedChange={(v) =>
                    setSelected((prev) => (v ? [...prev, u.id] : prev.filter((id) => id !== u.id)))
                  }
                />
                <UserAvatar className="size-9" name={u.nickname} url={u.avatarUrl} hue={u.avatarHue} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium text-white">{u.nickname}</span>
                    <span className={cn('rounded-full border px-1.5 py-0 text-[10px]', ROLE_META[u.role]?.tone || ROLE_META.user.tone)}>
                      {u.role === 'admin' ? <Crown className="mr-0.5 inline size-2.5" /> : null}
                      {u.role === 'assessor' ? <Gavel className="mr-0.5 inline size-2.5" /> : u.role === 'superadmin' ? <ShieldCheck className="mr-0.5 inline size-2.5" /> : null}
                      {ROLE_META[u.role]?.label || '普通用户'}
                    </span>
                    <span className={cn('rounded-full border px-1.5 py-0 text-[10px]', statusTone(u.status))}>
                      {STATUS_TEXT[u.status]}
                    </span>
                    {isSelf && <Badge variant="secondary" className="px-1.5 py-0 text-[9.5px]">当前登录</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                    {u.username && <span className="text-slate-400">@{u.username}</span>}
                    <span className="truncate">{u.email || u.phoneMasked || u.phone || '—'}</span>
                    <span className="size-1 rounded-full bg-slate-700" />
                    <span>注册 {formatDate(u.createdAt)}</span>
                    <span className="size-1 rounded-full bg-slate-700" />
                    <span>活跃 {relativeTime(u.lastLoginAt)}</span>
                  </div>
                </div>

                <div className="hidden shrink-0 items-center gap-4 text-center sm:flex">
                  <div>
                    <div className="text-[13px] font-medium text-slate-200">{u.claimsTotal}</div>
                    <div className="text-[10px] text-slate-500">申请</div>
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-slate-200">{u.names.length}</div>
                    <div className="text-[10px] text-slate-500">圈名</div>
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-slate-200">{u.loginCount}</div>
                    <div className="text-[10px] text-slate-500">登录</div>
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onSelect={() => setDetail(u)}>
                      <UserCog /> 查看详情
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { setTitleTarget(u); setTitleValue(u.title || ''); }}>
                      <Award /> 设置头衔
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { setPwdTarget(u); setPwdMode('random'); setPwdValue(''); }}>
                      <KeyRound /> 重置密码
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>调整权限组</DropdownMenuLabel>
                    {ROLE_OPTIONS.map((r) => (
                      <DropdownMenuItem
                        key={r.value}
                        disabled={isSelf || u.role === r.value}
                        onSelect={() => {
                          setRoleTarget(u);
                          setRoleValue(r.value);
                        }}
                      >
                        {r.value === 'admin' ? <Crown /> : r.value === 'superadmin' ? <ShieldCheck /> : r.value === 'assessor' ? <Gavel /> : <Users2 />}
                        设为{r.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    {u.status === 'active' ? (
                      <DropdownMenuItem variant="danger" onSelect={() => { setBanTarget(u); setBanReason('违反平台规则'); }}>
                        <Ban /> 封禁账号
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => patch(u.id, { status: 'active' }, '已解封该账号')}>
                        <CheckCircle2 /> 解除封禁
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem variant="danger" onSelect={() => setDelTarget(u)}>
                      <Trash2 /> 删除用户
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}

          <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />
        </div>
      ) : (
        <div className="glass rounded-2xl py-14 text-center text-[13px] text-slate-400">没有符合条件的用户</div>
      )}

      {/* 详情 */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-lg">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {detail.nickname}
                  <span className={cn('rounded-full border px-1.5 py-0 text-[10px]', ROLE_META[detail.role]?.tone)}>
                    {ROLE_META[detail.role]?.label}
                  </span>
                </DialogTitle>
                <DialogDescription>用户 ID：{detail.id}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                {[
                  { k: '用户名', v: detail.username || '—' },
                  { k: '手机号', v: detail.phoneMasked || detail.phone || '—' },
                  { k: '邮箱', v: detail.email || '—' },
                  { k: '状态', v: STATUS_TEXT[detail.status] },
                  { k: '注册时间', v: formatDate(detail.createdAt, true) },
                  { k: '最近登录', v: detail.lastLoginAt ? formatDate(detail.lastLoginAt, true) : '从未登录' },
                  { k: '登录次数', v: `${detail.loginCount} 次` },
                  { k: '最近 IP', v: detail.lastIp || '—' },
                  { k: '提交申请', v: `${detail.claimsTotal} 条` },
                  { k: '提交申诉', v: `${detail.appealsTotal ?? 0} 条` },
                  { k: '小法庭投票', v: detail.courtPermission === false ? '已收回' : '正常' },
                ].map((i) => (
                  <div key={i.k} className="rounded-xl border border-white/8 bg-white/[0.04] p-2.5">
                    <div className="text-[10.5px] text-slate-500">{i.k}</div>
                    <div className="mt-0.5 break-all text-slate-200">{i.v}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.04] p-3">
                <div className="text-[10.5px] text-slate-500">已绑定圈名</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {detail.names.length === 0 ? (
                    <span className="text-[12px] text-slate-400">无</span>
                  ) : (
                    detail.names.map((n) => (
                      <Badge key={n} variant="secondary">{n}</Badge>
                    ))
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['qq', 'wechat', 'xiaohongshu'] as const).map((k) =>
                  detail.bindings?.[k] ? (
                    <Badge key={k} variant="secondary">
                      {k === 'qq' ? 'QQ' : k === 'wechat' ? '微信' : '小红书'}：{detail.bindings[k]?.handle}
                    </Badge>
                  ) : null,
                )}
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.04] p-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10.5px] text-slate-500">本月绑定修改次数</div>
                  <span className="text-[11px] text-slate-400">
                    {detail.bindingUsage?.used ?? 0} / {detail.bindingUsage?.limit ?? 3}
                  </span>
                </div>
                <div className="mt-1.5 flex gap-1">
                  {Array.from({ length: detail.bindingUsage?.limit ?? 3 }).map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        'h-1.5 flex-1 rounded-full',
                        i < (detail.bindingUsage?.used ?? 0) ? 'bg-slate-600' : 'bg-gradient-to-r from-violet-400 to-cyan-400',
                      )}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => openBindEditor(detail)}>
                  <Link2 className="size-3.5" /> 代改社交绑定
                </Button>
                {detail.role === 'user' && (
                  <Button
                    size="sm"
                    variant={detail.courtPermission === false ? 'destructive' : 'secondary'}
                    onClick={async () => {
                      try {
                        const next = detail.courtPermission === false;
                        await api.patch(`/admin/users/${detail.id}/court-permission`, { allow: next });
                        toast.success(next ? '已恢复小法庭投票权限' : '已收回小法庭投票权限');
                        setDetail({ ...detail, courtPermission: next } as any);
                        load();
                      } catch (err) {
                        toast.error(err instanceof ApiError ? err.message : '操作失败');
                      }
                    }}
                  >
                    <Scale className="size-3.5" />
                    {detail.courtPermission === false ? '恢复投票权' : '收回投票权'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await api.post(`/admin/users/${detail.id}/bindings/reset-quota`);
                      toast.success('已重置该用户本月绑定修改次数');
                      setDetail(null);
                      load();
                    } catch (err) {
                      toast.error(err instanceof ApiError ? err.message : '操作失败');
                    }
                  }}
                >
                  <RotateCcw className="size-3.5" /> 重置次数
                </Button>
              </div>
              {detail.status === 'banned' && (
                <div className="rounded-xl border border-rose-300/20 bg-rose-400/[0.08] p-3 text-[12px] text-rose-200">
                  该账号已被封禁，封禁后其所有会话已失效。
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 代改社交绑定 */}
      <Dialog open={!!bindTarget} onOpenChange={(o) => !o && setBindTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>代改「{bindTarget?.nickname}」的社交绑定</DialogTitle>
            <DialogDescription>
              管理员修改不受每月 3 次限制，保存后用户会收到通知。留空表示解除绑定。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {[
              { key: 'qq' as const, label: 'QQ', placeholder: '5-12 位 QQ 号' },
              { key: 'wechat' as const, label: '微信', placeholder: '6-20 位微信号（字母开头）' },
              { key: 'xiaohongshu' as const, label: '小红书', placeholder: '小红书号' },
            ].map((f) => (
              <div key={f.key} className="space-y-2">
                <Label htmlFor={`bind-${f.key}`}>
                  {f.label}
                  {bindTarget?.bindings?.[f.key] ? (
                    <span className="ml-1 text-[10px] text-slate-500">当前：{bindTarget.bindings[f.key]?.handle}</span>
                  ) : (
                    <span className="ml-1 text-[10px] text-slate-500">未绑定</span>
                  )}
                </Label>
                <Input
                  id={`bind-${f.key}`}
                  value={bindForm[f.key]}
                  onChange={(e) => setBindForm({ ...bindForm, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                />
              </div>
            ))}
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2.5 text-[11px] text-slate-500">
              留空并保存即解除该平台绑定；填入新账号会覆盖原绑定。
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBindTarget(null)}>取消</Button>
            <Button onClick={saveBindings} disabled={bindSaving}>
              {bindSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} 保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 调整权限组 */}
      <Dialog open={!!roleTarget} onOpenChange={(o) => !o && setRoleTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>调整「{roleTarget?.nickname}」的权限组</DialogTitle>
            <DialogDescription>调整后该用户会收到通知，权限立即生效。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>权限组</Label>
            <div className="grid gap-1.5">
              {ROLE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRoleValue(r.value)}
                  className={cn(
                    'flex items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition',
                    roleValue === r.value
                      ? 'border-violet-300/45 bg-violet-400/12'
                      : 'border-white/8 bg-white/[0.03] hover:border-white/16',
                  )}
                >
                  <span className={cn('mt-0.5 rounded-full border px-1.5 py-0 text-[10px]', ROLE_META[r.value].tone)}>{r.label}</span>
                  <span className="flex-1 text-[11px] leading-relaxed text-slate-400">{ROLE_META[r.value].desc}</span>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRoleTarget(null)}>取消</Button>
            <Button
              disabled={acting || !roleTarget}
              onClick={() => roleTarget && patch(roleTarget.id, { role: roleValue }, `已设为${ROLE_META[roleValue].label}`)}
            >
              {acting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} 确认调整
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量调整 */}
      <Dialog open={!!batchRole} onOpenChange={(o) => !o && setBatchRole(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>批量设为「{batchRole ? ROLE_META[batchRole].label : ''}」</DialogTitle>
            <DialogDescription>将对已选择的 {selected.length} 位用户生效，当前登录账号会被自动跳过。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBatchRole(null)}>取消</Button>
            <Button onClick={applyBatch} disabled={acting}>
              {acting ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" />} 确认调整
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 封禁 */}
      <Dialog open={!!banTarget} onOpenChange={(o) => !o && setBanTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>封禁「{banTarget?.nickname}」</DialogTitle>
            <DialogDescription>封禁后该用户将立即退出登录，且无法再次登录。管理员、超级管理员与审核员需先降级为普通用户。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ban-reason">封禁原因</Label>
            <Input id="ban-reason" value={banReason} onChange={(e) => setBanReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBanTarget(null)}>取消</Button>
            <Button
              variant="destructive"
              disabled={acting}
              onClick={() => banTarget && patch(banTarget.id, { status: 'banned', banReason }, '账号已封禁')}
            >
              {acting ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />} 确认封禁
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除 */}
      {/* 重置指定用户密码 */}
      <Dialog open={!!pwdTarget} onOpenChange={(o) => !o && setPwdTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-amber-300" /> 重置密码
            </DialogTitle>
            <DialogDescription>
              为「{pwdTarget?.nickname}」设置新密码。重置后该用户所有登录会话将立即失效，需用新密码重新登录。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'random' as const, label: '随机生成', desc: '自动生成强密码' },
                { key: 'manual' as const, label: '手动指定', desc: '自行输入新密码' },
              ].map((m) => (
                <button
                  key={m.key}
                  onClick={() => setPwdMode(m.key)}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left transition',
                    pwdMode === m.key
                      ? 'border-violet-300/45 bg-violet-400/12'
                      : 'border-white/10 bg-white/[0.03] hover:border-white/20',
                  )}
                >
                  <div className="text-[12px] font-medium text-white">{m.label}</div>
                  <div className="mt-0.5 text-[10.5px] text-slate-500">{m.desc}</div>
                </button>
              ))}
            </div>

            {pwdMode === 'manual' && (
              <div className="space-y-1.5">
                <Label htmlFor="new-pwd">新密码</Label>
                <Input
                  id="new-pwd"
                  type="text"
                  value={pwdValue}
                  onChange={(e) => setPwdValue(e.target.value.slice(0, 64))}
                  placeholder="至少 8 位，需包含字母与数字"
                />
              </div>
            )}

            <div className="rounded-xl border border-amber-300/20 bg-amber-400/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-amber-200/90">
              新密码仅在此处显示一次，请立即复制并通过安全渠道告知用户。
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setPwdTarget(null)}>取消</Button>
            <Button
              onClick={async () => {
                if (!pwdTarget) return;
                if (pwdMode === 'manual' && pwdValue.trim().length < 8) {
                  toast.error('新密码至少 8 位');
                  return;
                }
                try {
                  const body: any = { mode: pwdMode };
                  if (pwdMode === 'manual') body.password = pwdValue.trim();
                  const r = await api.post<{ password: string; username: string }>(
                    `/admin/users/${pwdTarget.id}/reset-password`,
                    body,
                  );
                  setPwdTarget(null);
                  setPwdValue('');
                  // 用弹窗展示新密码，避免 toast 一闪而过不好复制
                  setResetResult({ username: r.username || pwdTarget.username, password: r.password });
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : '重置失败');
                }
              }}
            >
              <KeyRound className="size-4" /> 确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置结果（明文仅显示一次） */}
      <Dialog open={!!resetResult} onOpenChange={(o) => !o && setResetResult(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-300" /> 密码已重置
            </DialogTitle>
            <DialogDescription>请立即复制并转告用户，关闭后将无法再次查看。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="rounded-xl border border-white/8 bg-white/[0.04] p-3">
              <div className="text-[10.5px] text-slate-500">账号</div>
              <div className="break-all font-mono text-[13px] text-white">{resetResult?.username}</div>
            </div>
            <div className="rounded-xl border border-emerald-300/25 bg-emerald-400/[0.08] p-3">
              <div className="text-[10.5px] text-emerald-300/70">新密码</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="break-all font-mono text-[13px] text-emerald-100">{resetResult?.password}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto shrink-0"
                  onClick={() => {
                    navigator.clipboard?.writeText(resetResult?.password || '');
                    toast.success('已复制');
                  }}
                >
                  <Copy className="size-3.5" /> 复制
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setResetResult(null)}>我知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 设置头衔 */}
      <Dialog open={!!titleTarget} onOpenChange={(o) => !o && setTitleTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Award className="size-4 text-amber-300" /> 设置头衔
            </DialogTitle>
            <DialogDescription>
              为「{titleTarget?.nickname}」设置展示头衔，会显示在个人中心与圈名详情页。留空表示移除。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="title-input">头衔（最多 20 字）</Label>
            <Input
              id="title-input"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value.slice(0, 20))}
              placeholder="例如：元老圈友 / 认证创作者"
            />
            <div className="flex flex-wrap gap-1.5">
              {['元老圈友', '认证创作者', '社区贡献者', '荣誉成员'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTitleValue(t)}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-400 transition hover:border-amber-300/40 hover:text-amber-200"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setTitleTarget(null)}>取消</Button>
            <Button
              disabled={acting}
              onClick={async () => {
                if (!titleTarget) return;
                setActing(true);
                try {
                  await api.post(`/admin/users/${titleTarget.id}/title`, { title: titleValue.trim() });
                  toast.success(titleValue.trim() ? '头衔已设置' : '头衔已移除');
                  setTitleTarget(null);
                  load();
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : '设置失败');
                } finally {
                  setActing(false);
                }
              }}
            >
              <Award className="size-4" /> 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除用户「{delTarget?.nickname}」</DialogTitle>
            <DialogDescription>
              删除后该账号将被匿名化处理并禁止登录，其名下的圈名会一并下架。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDelTarget(null)}>取消</Button>
            <Button variant="destructive" disabled={acting} onClick={remove}>
              {acting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} 确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
