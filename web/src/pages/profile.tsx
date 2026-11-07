import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BadgeCheck,
  Check,
  Clock3,
  Copy,
  ImagePlus,
  KeyRound,
  Mail,
  Link2,
  Link2Off,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Scale,
  ShieldAlert,
  Sparkles,
  Flag,
  Gavel,
  Trash2,
  X,
  Repeat,
  Smartphone,
  Camera,
  ImageUp,
  Award,
  Clock3 as ClockIcon,
  Trash2 as TrashIcon,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { ClaimForm } from '@/components/claim-form';
import { JoinGroupButton } from '@/components/join-group-button';
import { useAuth } from '@/lib/auth';
import { api, ApiError, type Appeal, type Claim, type NameItem, type User } from '@/lib/api';
import { cn, formatDate, initials, relativeTime, statusTone, STATUS_TEXT, BINDING_META, ROLE_META, emailProviderLabel, type PlatformKey } from '@/lib/utils';

type ProfileData = {
  user: User;
  names: NameItem[];
  claims: Claim[];
  appeals: Appeal[];
  stats: {
    claims: number;
    pending: number;
    approved: number;
    rejected: number;
    names: number;
    appeals: number;
    appealsPending: number;
  };
  platforms: Record<PlatformKey, { label: string; hint: string }>;
  binding: { usage: { month: string; used: number; limit: number; remaining: number; resetAt: string }; limit: number };
};

const STATUS_ICON = {
  pending: Clock3,
  approved: Check,
  rejected: X,
};

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab') || 'names';
  const tab = rawTab === 'claim' ? 'claims' : rawTab;
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  // 小法庭发起弹窗
  const [courtDialog, setCourtDialog] = useState<{ open: boolean; appeal?: any }>({ open: false });
  const [courtHours, setCourtHours] = useState(48);
  const [courtLoading, setCourtLoading] = useState(false);
  // 圈名编辑（简介 + 材料）
  const [nameEdit, setNameEdit] = useState<{ open: boolean; item?: any }>({ open: false });
  const [nameDesc, setNameDesc] = useState('');
  const [nameEvidence, setNameEvidence] = useState<any[]>([]);
  const [nameSaving, setNameSaving] = useState(false);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<Claim | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [bindTarget, setBindTarget] = useState<PlatformKey | null>(null);
  const [handle, setHandle] = useState('');
  const [binding, setBinding] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneValue, setPhoneValue] = useState('');
  const [phonePassword, setPhonePassword] = useState('');
  const [pwdOpen, setPwdOpen] = useState(false);
  const [avatarData, setAvatarData] = useState<{
    avatarUrl: string;
    title: string;
    pending: number;
    requests: { id: string; imageUrl: string; status: string; rejectReason: string; createdAt: string }[];
  } | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });

  const load = useCallback(async () => {
    try {
      const res = await api.get<ProfileData>('/me/profile');
      setData(res);
      setUser(res.user);
      setNickname(res.user.nickname);
      setBio(res.user.bio || '');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login?redirect=/me';
      }
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    load();
    api.get<any>('/me/avatar').then(setAvatarData).catch(() => {});
  }, [load]);

  // 从首页「提交圈名归属审核」跳转过来时，自动打开提交弹窗
  useEffect(() => {
    if (params.get('tab') === 'claim' && !loading) {
      setShowForm(true);
      setTab('claims');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const takenNames = useMemo(() => data?.names.map((n) => n.name) || [], [data]);

  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', v);
    setParams(next, { replace: true });
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      const res = await api.patch<{ user: User }>('/me/profile', { nickname, bio });
      setUser(res.user);
      setData((d) => (d ? { ...d, user: res.user } : d));
      setEditOpen(false);
      toast.success('资料已更新');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const doBind = async () => {
    if (!bindTarget) return;
    setBinding(true);
    try {
      const res = await api.post<{ user: User; usage: any; changed: boolean }>(`/me/bindings/${bindTarget}`, { handle });
      setUser(res.user);
      setData((d) => (d ? { ...d, user: res.user, binding: { usage: res.usage, limit: res.usage?.limit ?? d.binding.limit } } : d));
      toast.success(res.changed ? `${BINDING_META[bindTarget].label} 绑定已修改` : `${BINDING_META[bindTarget].label} 绑定成功`, {
        description: res.changed ? `本月剩余修改次数 ${res.usage?.remaining ?? 0} 次` : '首次绑定不占用修改次数',
      });
      setBindTarget(null);
      setHandle('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '绑定失败');
    } finally {
      setBinding(false);
    }
  };

  const doUnbind = async (platform: PlatformKey) => {
    try {
      const res = await api.del<{ user: User; usage: any }>(`/me/bindings/${platform}`);
      setUser(res.user);
      setData((d) => (d ? { ...d, user: res.user, binding: { usage: res.usage, limit: res.usage?.limit ?? d.binding.limit } } : d));
      toast.success(`已解绑${BINDING_META[platform].label}`, { description: `本月剩余修改次数 ${res.usage?.remaining ?? 0} 次` });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '解绑失败');
    }
  };

  const changePwd = async () => {
    if (pwd.next !== pwd.confirm) return toast.error('两次输入的新密码不一致');
    setSaving(true);
    try {
      await api.post('/me/password', { currentPassword: pwd.current, newPassword: pwd.next });
      toast.success('密码已修改');
      setPwdOpen(false);
      setPwd({ current: '', next: '', confirm: '' });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '修改失败');
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (id: string) => {
    try {
      await api.del(`/claims/${id}`);
      toast.success('申请已撤回');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '撤回失败');
    }
  };

  if (loading || !data || !user) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-10 sm:px-6">
        <Skeleton className="h-32 w-full rounded-3xl" />
        <Skeleton className="h-10 w-72 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    );
  }

  const { stats, names, claims } = data;
  const bindings = data.user.bindings || {};

  const openNameEdit = (item: any) => {
    setNameEdit({ open: true, item });
    setNameDesc(item.description || '');
    setNameEvidence([]);
    setEvidenceFiles([]);
    api
      .get<{ name: { evidence?: any[] } }>(`/names/${item.id}`)
      .then((r) => setNameEvidence(r.name?.evidence || []))
      .catch(() => setNameEvidence([]));
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* 头部资料卡 */}
      <div className="glass relative overflow-hidden rounded-3xl p-6 sm:p-7">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(26rem 18rem at 100% 0%, hsl(${user.avatarHue} 80% 55% / 0.18), transparent 70%)`,
          }}
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative shrink-0">
            <Avatar className="size-16 ring-2 ring-white/10">
              {avatarData?.avatarUrl || user.avatarUrl ? (
                <AvatarImage src={avatarData?.avatarUrl || user.avatarUrl} alt={user.nickname} />
              ) : null}
              <AvatarFallback
                className="text-xl"
                style={{
                  background: `linear-gradient(135deg, hsl(${user.avatarHue} 72% 55%), hsl(${(user.avatarHue + 55) % 360} 76% 45%))`,
                }}
              >
                {initials(user.nickname)}
              </AvatarFallback>
            </Avatar>
            <button
              onClick={() => { setAvatarFile(null); setAvatarPreview(''); setAvatarOpen(true); }}
              className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-full border border-white/20 bg-[#17172a] text-slate-300 shadow transition hover:border-violet-300/50 hover:text-violet-200"
              title="更换头像（需审核）"
            >
              <Camera className="size-3" />
            </button>
            {avatarData?.pending ? (
              <span className="absolute -top-1 -left-1 flex size-3">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-70" />
                <span className="relative inline-flex size-3 rounded-full bg-amber-500" />
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-white">{user.nickname}</h1>
              {(avatarData?.title || user.title) && (
                <span className="flex items-center gap-1 rounded-full border border-amber-300/35 bg-gradient-to-r from-amber-400/20 to-orange-400/10 px-2 py-0.5 text-[10.5px] font-medium text-amber-200">
                  <Award className="size-3" /> {avatarData?.title || user.title}
                </span>
              )}
              <span className={cn('rounded-full border px-2 py-0.5 text-[10.5px]', ROLE_META[user.role]?.tone || ROLE_META.user.tone)}>
                {ROLE_META[user.role]?.label || '普通用户'}
              </span>
              {user.email && (
                <Badge variant="success" className="gap-1">
                  <BadgeCheck className="size-3" /> {emailProviderLabel(user.email)}已验证
                </Badge>
              )}
              {user.phone && (
                <Badge variant="cyan" className="gap-1">
                  <Smartphone className="size-3" /> 手机号已验证
                </Badge>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-slate-400">
              {user.email ? (
                <span className="flex items-center gap-1.5 break-all">
                  <Mail className="size-3.5 shrink-0 text-slate-500" />
                  {user.email}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-slate-500">
                  <Mail className="size-3.5" /> 未绑定邮箱
                </span>
              )}
              {user.phone ? (
                <span className="flex items-center gap-1.5">
                  <Smartphone className="size-3.5 shrink-0 text-slate-500" />
                  {user.phoneMasked || user.phone}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-slate-500">
                  <Smartphone className="size-3.5" /> 未绑定手机号
                </span>
              )}
            </div>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-slate-400">
              {user.bio || '这个人很神秘，还没有写下简介。'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px] text-slate-500">
              <span>注册于 {formatDate(user.createdAt)}</span>
              <span className="size-1 rounded-full bg-slate-700" />
              <span>最近登录 {relativeTime(user.lastLoginAt)}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-3.5" /> 编辑资料
            </Button>
            {(user.role === 'admin' || user.role === 'assessor') && (
              <Button size="sm" asChild>
                <Link to="/admin">
                  <ShieldCheck className="size-3.5" /> 管理后台
                </Link>
              </Button>
            )}
          </div>
        </div>

        <div className="relative mt-6 grid grid-cols-3 gap-2 sm:gap-2.5 lg:grid-cols-5">
          {[
            { label: '已绑定圈名', value: stats.names, icon: BadgeCheck, tone: 'text-violet-200' },
            { label: '审核中', value: stats.pending, icon: Clock3, tone: 'text-amber-200' },
            { label: '审核通过', value: stats.approved, icon: Check, tone: 'text-emerald-200' },
            { label: '被驳回', value: stats.rejected, icon: X, tone: 'text-rose-200' },
            { label: '申诉中', value: stats.appealsPending, icon: Flag, tone: 'text-sky-200' },
          ].map((s) => (
            <div key={s.label} className="min-w-0 rounded-2xl border border-white/8 bg-white/[0.035] px-3 py-3">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] leading-snug text-slate-400">
                <s.icon className={cn('size-3', s.tone)} />
                {s.label}
              </div>
              <div className="mt-1 text-xl font-semibold text-white">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <TabsList className="no-scrollbar flex w-full max-w-full flex-nowrap overflow-x-auto sm:w-auto">
            <TabsTrigger value="names" className="shrink-0">
              我的圈名 <span className="ml-0.5 text-[10px] text-slate-500">{names.length}</span>
            </TabsTrigger>
            <TabsTrigger value="claims" className="shrink-0">
              归属申请 <span className="ml-0.5 text-[10px] text-slate-500">{claims.length}</span>
            </TabsTrigger>
            <TabsTrigger value="appeals" className="shrink-0">
              归属申诉 <span className="ml-0.5 text-[10px] text-slate-500">{data.appeals.length}</span>
            </TabsTrigger>
            <TabsTrigger value="bindings" className="shrink-0">账号绑定</TabsTrigger>
            <TabsTrigger value="security" className="shrink-0">安全设置</TabsTrigger>
            <TabsTrigger value="feedback" className="shrink-0">我的反馈</TabsTrigger>
          </TabsList>
          <Button size="sm" className="self-start sm:self-auto" onClick={() => setShowForm(true)}>
            <Plus className="size-3.5" /> 提交归属审核
          </Button>
        </div>

        {/* 我的圈名 */}
        <TabsContent value="names" className="mt-4">
          {names.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="还没有已绑定的圈名"
              desc="提交圈名归属审核并通过后，你的圈名会展示在这里，同时出现在圈名广场。"
              action={
                <Button onClick={() => setShowForm(true)}>
                  <ImagePlus className="size-4" /> 提交归属审核
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {names.map((n) => (
                <div key={n.id} className="glass group relative overflow-hidden rounded-2xl p-5">
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background: `radial-gradient(18rem 12rem at 100% 0%, hsl(${n.owner?.avatarHue ?? 260} 80% 55% / 0.16), transparent 70%)`,
                    }}
                  />
                  <div className="relative flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{n.name}</h3>
                      <div className="mt-1 flex items-center gap-2 text-[11.5px] text-slate-500">
                        <span>通过于 {formatDate(n.approvedAt)}</span>
                      </div>
                    </div>
                    <Badge variant="success" className="gap-1">
                      <BadgeCheck className="size-3" /> 已认证
                    </Badge>
                  </div>

                  <div className="relative mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openNameEdit(n)}>
                      <Pencil className="size-3.5" /> 编辑简介与材料
                    </Button>
                  </div>
                  <p className="relative mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-slate-400">
                    {n.description || '未填写简介'}
                  </p>
                  <div className="relative mt-4 flex items-center justify-between border-t border-white/[0.07] pt-3 text-[11px] text-slate-500">
                    <span>{n.views} 次浏览</span>
                    <Link to={`/names/${n.id}`} className="flex items-center gap-1 text-violet-300 hover:text-violet-200">
                      查看详情 <Link2 className="size-3" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* 归属申请 */}
        <TabsContent value="claims" className="mt-4">
          {claims.length === 0 ? (
            <EmptyState
              icon={Clock3}
              title="还没有提交过归属申请"
              desc="上传能证明你使用该圈名的截图，管理员审核通过后即可完成绑定。"
              action={
                <Button onClick={() => setShowForm(true)}>
                  <ImagePlus className="size-4" /> 提交归属审核
                </Button>
              }
            />
          ) : (
            <div className="space-y-2.5">
              {claims.map((c) => {
                const Icon = STATUS_ICON[c.status];
                return (
                  <div key={c.id} className="glass-soft flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div
                        className={cn(
                          'mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border',
                          statusTone(c.status),
                        )}
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14.5px] font-medium text-white">{c.name}</span>
                          <Badge
                            variant={c.status === 'approved' ? 'success' : c.status === 'pending' ? 'warning' : 'danger'}
                          >
                            {STATUS_TEXT[c.status]}
                          </Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-500">
                          <span>提交于 {formatDate(c.createdAt, true)}</span>
                          {c.reviewedAt && (
                            <>
                              <span className="size-1 rounded-full bg-slate-700" />
                              <span>审核于 {formatDate(c.reviewedAt, true)}</span>
                            </>
                          )}
                          <span className="size-1 rounded-full bg-slate-700" />
                          <span>{c.images.length} 张材料</span>
                        </div>
                        {c.status === 'rejected' && c.rejectReason && (
                          <p className="mt-2 rounded-lg border border-rose-300/15 bg-rose-400/[0.07] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-rose-200/90">
                            驳回理由：{c.rejectReason}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => setDetail(c)}>
                        查看材料
                      </Button>
                      {c.status === 'pending' && (
                        <Button variant="ghost" size="sm" className="text-rose-300 hover:text-rose-200" onClick={() => withdraw(c.id)}>
                          <Trash2 className="size-3.5" /> 撤回
                        </Button>
                      )}
                      {c.status === 'rejected' && (
                        <Button size="sm" variant="secondary" onClick={() => setShowForm(true)}>
                          重新提交
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* 归属申诉 */}
        <TabsContent value="appeals" className="mt-4">
          {data.appeals.length === 0 ? (
            <EmptyState
              icon={Flag}
              title="还没有提交过归属申诉"
              desc="在圈名详情页可以对你认为归属有争议的圈名提交申诉材料，审核通过后归属将转移至你的账号。"
              action={
                <Button asChild variant="secondary">
                  <Link to="/">
                    <Sparkles className="size-4" /> 去圈名广场看看
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="space-y-2.5">
              {data.appeals.map((a) => (
                <div key={a.id} className="glass-soft flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border', statusTone(a.status))}>
                      <Gavel className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/names/${a.nameId}`} className="text-[14.5px] font-medium text-white hover:text-violet-200">
                          {a.name}
                        </Link>
                        <Badge variant={a.status === 'approved' ? 'success' : a.status === 'pending' ? 'warning' : 'danger'}>
                          {a.status === 'approved' ? '申诉成功' : a.status === 'pending' ? '审核中' : '已驳回'}
                        </Badge>
                        <span className="text-[11px] text-slate-500">原归属：{a.ownerNickname}</span>
                      </div>
                      <div className="mt-1 text-[11.5px] text-slate-500">申诉类型：{a.reason}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-500">
                        <span>提交于 {formatDate(a.createdAt, true)}</span>
                        {a.reviewedAt && (
                          <>
                            <span className="size-1 rounded-full bg-slate-700" />
                            <span>审核于 {formatDate(a.reviewedAt, true)}</span>
                          </>
                        )}
                        <span className="size-1 rounded-full bg-slate-700" />
                        <span>{a.images.length} 张材料</span>
                      </div>
                      {a.status === 'rejected' && a.rejectReason && (
                        <p className="mt-2 rounded-lg border border-rose-300/15 bg-rose-400/[0.07] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-rose-200/90">
                          驳回理由：{a.rejectReason}
                        </p>
                      )}
                      {a.status === 'approved' && (
                        <p className="mt-2 rounded-lg border border-emerald-300/15 bg-emerald-400/[0.07] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-emerald-200/90">
                          申诉已通过，圈名归属已转移至你的账号，原归属者已收到通知。
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {a.status === 'pending' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-300 hover:text-rose-200"
                        onClick={async () => {
                          try {
                            await api.del(`/appeals/${a.id}`);
                            toast.success('申诉已撤回');
                            load();
                          } catch (err) {
                            toast.error(err instanceof ApiError ? err.message : '撤回失败');
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" /> 撤回
                      </Button>
                    )}
                    {/* 小法庭：仅人工申诉被驳回的一方可申请（胜诉方无需申请） */}
                    {a.status === 'rejected' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => { setCourtDialog({ open: true, appeal: a }); }}
                      >
                        <Scale className="size-3.5" /> 申请小法庭介入
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/names/${a.nameId}`}>查看圈名</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* 账号与绑定 */}
        <TabsContent value="bindings" className="mt-4">
          {/* 额度提示 */}
          <div className="glass-soft mb-3 flex flex-wrap items-center gap-3 rounded-2xl p-4">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05]">
                <Repeat className="size-4 text-violet-200" />
              </div>
              <div>
                <div className="text-[13px] font-medium text-white">绑定修改次数</div>
                <div className="text-[11px] text-slate-500">
                  每月可修改 {data.binding.limit} 次，首次绑定不占用额度
                </div>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right">
                <div className="text-[11px] text-slate-500">本月已用</div>
                <div className="text-[15px] font-semibold text-white">
                  {data.binding.usage.used}
                  <span className="text-[11px] font-normal text-slate-500"> / {data.binding.limit}</span>
                </div>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: data.binding.limit }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-7 w-1.5 rounded-full',
                      i < data.binding.usage.used ? 'bg-slate-600' : 'bg-gradient-to-b from-violet-400 to-cyan-400',
                    )}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* 邮箱 */}
          <Card className="mb-3 gap-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
                <Mail className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-white">邮箱</div>
                <div className="break-all text-[11px] text-slate-500">
                  {user.email ? `已绑定 ${user.email}` : '未绑定邮箱'}
                </div>
              </div>
              {user.email ? (
                <Badge variant="success">{emailProviderLabel(user.email)}</Badge>
              ) : (
                <Badge variant="secondary">未绑定</Badge>
              )}
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-[11.5px] text-slate-400">
              邮箱用于接收验证码与账号找回通知，如需更换请联系管理员。
            </div>
          </Card>

          {/* 手机号 */}
          <Card className="mb-3 gap-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 text-white">
                <Smartphone className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-white">手机号</div>
                <div className="text-[11px] text-slate-500">
                  {user.phone ? `已绑定 ${user.phoneMasked || user.phone}` : '未绑定手机号'}
                </div>
              </div>
              {user.phone ? <Badge variant="success">已验证</Badge> : <Badge variant="secondary">未绑定</Badge>}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPhoneValue('');
                  setPhonePassword('');
                  setPhoneOpen(true);
                }}
              >
                <Pencil className="size-3.5" /> {user.phone ? '修改' : '绑定'}
              </Button>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-[11.5px] text-slate-400">
              账号标识：<span className="text-slate-200">{user.username || '—'}</span>
              {user.phone && <span className="ml-3">手机号：<span className="text-slate-200">{user.phoneMasked || user.phone}</span></span>}
            </div>
          </Card>

          {/* 社交平台 */}
          <div className="grid gap-3 md:grid-cols-3">
            {(Object.keys(BINDING_META) as PlatformKey[]).map((key) => {
              const meta = BINDING_META[key];
              const bound = bindings[key];
              return (
                <Card key={key} className="gap-4 p-5">
                  <div className="flex items-center gap-3">
                    <div className={cn('grid size-10 place-items-center rounded-xl bg-gradient-to-br text-sm font-semibold text-white', meta.color)}>
                      {meta.short}
                    </div>
                    <div>
                      <div className="text-[14px] font-medium text-white">{meta.label}</div>
                      <div className="text-[11px] text-slate-500">{bound ? '已绑定' : '未绑定'}</div>
                    </div>
                    {bound && <Badge variant="success" className="ml-auto">已验证</Badge>}
                  </div>

                  {bound ? (
                    <>
                      <div className="rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
                        <div className="text-[10.5px] text-slate-500">绑定账号</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-200">
                          <span className="truncate">{bound.handle}</span>
                          <button
                            onClick={() => {
                              navigator.clipboard?.writeText(bound.handle);
                              toast.success('已复制');
                            }}
                            className="text-slate-500 transition hover:text-white"
                          >
                            <Copy className="size-3" />
                          </button>
                        </div>
                        <div className="mt-0.5 text-[10.5px] text-slate-600">绑定于 {formatDate(bound.boundAt)}</div>
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1"
                          disabled={data.binding.usage.remaining <= 0}
                          onClick={() => {
                            setBindTarget(key);
                            setHandle(bound.handle);
                          }}
                        >
                          <Pencil className="size-3.5" /> 修改
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-300 hover:text-rose-200"
                          disabled={data.binding.usage.remaining <= 0}
                          onClick={() => doUnbind(key)}
                        >
                          <Link2Off className="size-3.5" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-[12px] leading-relaxed text-slate-500">
                        绑定{meta.label}后，圈名详情页会展示对应标识，便于他人确认身份。
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setBindTarget(key);
                          setHandle('');
                        }}
                      >
                        <Link2 className="size-3.5" /> 绑定{meta.label}
                      </Button>
                    </>
                  )}
                </Card>
              );
            })}
          </div>

          <div className="glass-soft mt-3 flex items-start gap-2.5 rounded-2xl p-4 text-[12px] leading-relaxed text-slate-400">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300/80" />
            <span>
              绑定信息仅用于身份辅助确认，平台不会向第三方公开你的账号隐私。
              每月最多修改 {data.binding.limit} 次绑定，次数用尽后需等待下月重置或联系管理员。
            </span>
          </div>
        </TabsContent>

        {/* 我的反馈 */}
        <TabsContent value="feedback" className="mt-4">
          <Card className="gap-4 p-5">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05]">
                <MessageSquare className="size-4 text-violet-200" />
              </div>
              <div>
                <div className="text-[14px] font-medium text-white">反馈与漏洞提交</div>
                <div className="text-[11px] text-slate-500">提交 Bug、建议或安全漏洞，并查看管理员答复</div>
              </div>
            </div>
            <p className="text-[12px] leading-relaxed text-slate-400">
              你提交的反馈会进入管理员处理队列，处理进度与答复会同步到「通知中心」。
              若反馈内容涉及账号隐私，请勿在公开渠道披露。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to="/feedback">
                  <MessageSquare className="size-3.5" /> 前往提交 / 查看
                </Link>
              </Button>
              <JoinGroupButton variant="outline" label="加入交流群反馈" />
            </div>
          </Card>
        </TabsContent>

        {/* 安全设置 */}
        <TabsContent value="security" className="mt-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Card className="gap-4 p-5">
              <div className="flex items-center gap-2.5">
                <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05]">
                  <KeyRound className="size-4 text-violet-200" />
                </div>
                <div>
                  <div className="text-[14px] font-medium text-white">登录密码</div>
                  <div className="text-[11px] text-slate-500">建议定期更换，使用字母与数字组合</div>
                </div>
              </div>
              <Button variant="secondary" size="sm" className="w-full" onClick={() => setPwdOpen(true)}>
                修改密码
              </Button>
            </Card>

            <Card className="gap-4 p-5">
              <div className="flex items-center gap-2.5">
                <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05]">
                  <ShieldCheck className="size-4 text-emerald-200" />
                </div>
                <div>
                  <div className="text-[14px] font-medium text-white">账号状态</div>
                  <div className="text-[11px] text-slate-500">当前账号运行正常</div>
                </div>
              </div>
              <div className="space-y-1.5 rounded-xl border border-white/8 bg-white/[0.035] p-3 text-[11.5px] text-slate-400">
                <div className="flex justify-between">
                  <span>绑定邮箱</span>
                  <span className="break-all text-slate-200">{user.email || '未绑定'}</span>
                </div>
                <div className="flex justify-between">
                  <span>账号角色</span>
                  <span className="text-slate-200">{ROLE_META[user.role]?.label || '普通用户'}</span>
                </div>
                <div className="flex justify-between">
                  <span>注册时间</span>
                  <span className="text-slate-200">{formatDate(user.createdAt)}</span>
                </div>
              </div>
            </Card>
          </div>

          <div className="glass-soft mt-3 flex flex-col items-start justify-between gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
            <div>
              <div className="text-[13px] font-medium text-white">需要帮助？</div>
              <div className="mt-0.5 text-[11.5px] text-slate-500">忘记密码、账号异常或审核有疑问，都可以在交流群里找到我们。</div>
            </div>
            <JoinGroupButton />
          </div>
        </TabsContent>
      </Tabs>

      {/* 提交申请弹窗 */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>提交圈名归属审核</DialogTitle>
            <DialogDescription>
              填写圈名信息并上传归属权证明材料，管理员审核通过后圈名将绑定到你的账号。
            </DialogDescription>
          </DialogHeader>
          <ClaimForm
            takenNames={takenNames}
            onSubmitted={() => {
              setShowForm(false);
              setTab('claims');
              load();
            }}
          />
        </DialogContent>
      </Dialog>

      {/* 材料详情 */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {detail.name}
                  <Badge variant={detail.status === 'approved' ? 'success' : detail.status === 'pending' ? 'warning' : 'danger'}>
                    {STATUS_TEXT[detail.status]}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  提交于 {formatDate(detail.createdAt, true)}
                </DialogDescription>
              </DialogHeader>
              <p className="text-[13px] leading-relaxed text-slate-300">{detail.description || '未填写简介'}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {detail.images.map((img, i) => (
                  <a
                    key={i}
                    href={img.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative overflow-hidden rounded-xl border border-white/10"
                  >
                    <img src={img.url} alt={img.name} className="h-28 w-full object-cover transition group-hover:scale-105" />
                  </a>
                ))}
              </div>
              {detail.status === 'rejected' && detail.rejectReason && (
                <div className="rounded-xl border border-rose-300/20 bg-rose-400/[0.08] p-3 text-[12px] leading-relaxed text-rose-200">
                  <div className="mb-1 font-medium">驳回理由</div>
                  {detail.rejectReason}
                </div>
              )}
              {detail.status === 'approved' && (
                <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/[0.08] p-3 text-[12px] leading-relaxed text-emerald-200">
                  审核通过，圈名已绑定到你的账号（{formatDate(detail.reviewedAt, true)}）。
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 编辑资料 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑个人资料</DialogTitle>
            <DialogDescription>昵称会展示在圈名详情页，简介最多 120 字。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-nick">昵称</Label>
              <Input id="edit-nick" value={nickname} onChange={(e) => setNickname(e.target.value.slice(0, 16))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-bio">个人简介</Label>
              <Textarea id="edit-bio" value={bio} onChange={(e) => setBio(e.target.value.slice(0, 120))} className="min-h-20" />
              <div className="text-right text-[11px] text-slate-500">{bio.length}/120</div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={saveProfile} disabled={saving}>
              {saving && <Loader2 className="size-3.5 animate-spin" />} 保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 绑定账号 */}
      {/* 编辑圈名简介与材料 */}
      <Dialog open={nameEdit.open} onOpenChange={(o) => setNameEdit((c) => ({ ...c, open: o }))}>
        <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-4 text-violet-300" /> 编辑「{nameEdit.item?.name}」
            </DialogTitle>
            <DialogDescription>修改圈名简介，补充能证明归属的材料图片。</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="name-desc">圈名简介</Label>
              <Textarea
                id="name-desc"
                value={nameDesc}
                onChange={(e) => setNameDesc(e.target.value.slice(0, 300))}
                placeholder="介绍一下这个圈名的含义、来源或使用场景"
                className="min-h-24"
              />
              <div className="text-right text-[10.5px] text-slate-500">{nameDesc.length}/300</div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>归属材料</Label>
                <span className="text-[10.5px] text-slate-500">{nameEvidence.length}/12 张</span>
              </div>
              {nameEvidence.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {nameEvidence.map((img, i) => (
                    <div key={img.url + i} className="group relative aspect-square overflow-hidden rounded-lg border border-white/10">
                      <img src={img.url} alt={img.name} className="size-full object-cover" />
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const r = await api.del<{ evidence: any[] }>(`/me/names/${nameEdit.item.id}/evidence`, { url: img.url } as any);
                            setNameEvidence(r.evidence || []);
                            toast.success('已删除');
                            load();
                          } catch (err) {
                            toast.error(err instanceof ApiError ? err.message : '删除失败');
                          }
                        }}
                        className="absolute top-1 right-1 rounded-full bg-rose-500/90 p-1 text-white opacity-0 transition group-hover:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                      {img.sha256 && (
                        <span className="absolute bottom-0 left-0 right-0 truncate bg-black/70 px-1 py-0.5 text-[8px] text-emerald-300">
                          {String(img.sha256).slice(0, 10)}…
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {nameEvidence.length < 12 && (
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-3 text-[11.5px] text-slate-400 transition hover:border-violet-300/40 hover:text-violet-200">
                  <ImagePlus className="size-4" />
                  {evidenceFiles.length ? `已选 ${evidenceFiles.length} 张，点击提交上传` : '点击选择图片补充材料'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const list = Array.from(e.target.files || []).slice(0, 4);
                      setEvidenceFiles(list);
                    }}
                  />
                </label>
              )}
              {evidenceFiles.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  disabled={nameSaving}
                  onClick={async () => {
                    setNameSaving(true);
                    try {
                      const form = new FormData();
                      evidenceFiles.forEach((f) => form.append('images', f));
                      const r = await api.post<{ evidence: any[] }>(`/me/names/${nameEdit.item.id}/evidence`, form);
                      setNameEvidence(r.evidence || []);
                      setEvidenceFiles([]);
                      toast.success('材料已上传');
                      load();
                    } catch (err) {
                      toast.error(err instanceof ApiError ? err.message : '上传失败');
                    } finally {
                      setNameSaving(false);
                    }
                  }}
                >
                  {nameSaving ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                  上传材料
                </Button>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setNameEdit({ open: false })}>关闭</Button>
            <Button
              disabled={nameSaving}
              onClick={async () => {
                setNameSaving(true);
                try {
                  await api.patch(`/me/names/${nameEdit.item.id}`, { description: nameDesc });
                  toast.success('简介已保存');
                  setNameEdit({ open: false });
                  load();
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : '保存失败');
                } finally {
                  setNameSaving(false);
                }
              }}
            >
              {nameSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              保存简介
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 申请小法庭 */}
      <Dialog open={courtDialog.open} onOpenChange={(o) => setCourtDialog((c) => ({ ...c, open: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="size-4 text-violet-300" /> 申请小法庭介入
            </DialogTitle>
            <DialogDescription>
              你的申诉已被人工驳回。如仍认为归属有误，可申请小法庭由社区投票裁决。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[12px] leading-relaxed text-slate-400">
              <div className="mb-1 font-medium text-white">{courtDialog.appeal?.name}</div>
              发起后双方轮番提交材料，管理员开启投票后由全体注册用户裁决。
            </div>

            {/* 关键风险提示 */}
            <div className="rounded-xl border border-rose-300/30 bg-rose-400/[0.10] p-3">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-rose-200">
                <ShieldAlert className="size-3.5" /> 请务必确认
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-rose-100/90">
                如果小法庭最终仍判定你未获得该圈名的归属权，
                <span className="font-medium text-rose-200">你将永久禁止再申诉该圈名</span>，
                此限制不可撤销。
              </p>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-500">
              投票截止时间由管理员设置，你无法自行调整。建议先准备好充分的材料再发起。
            </p>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="secondary" onClick={() => setCourtDialog({ open: false })}>我再想想</Button>
            <Button
              variant="destructive"
              disabled={courtLoading}
              onClick={async () => {
                if (!courtDialog.appeal) return;
                setCourtLoading(true);
                try {
                  const res = await api.post<{ court: any }>('/court', {
                    appealId: courtDialog.appeal.id,
                  });
                  toast.success('小法庭已创建', { description: '请先提交你的材料，等待对方回应' });
                  setCourtDialog({ open: false });
                  navigate('/court/' + res.court.id);
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : '发起失败');
                } finally {
                  setCourtLoading(false);
                }
              }}
            >
              {courtLoading ? <Loader2 className="size-4 animate-spin" /> : <Scale className="size-4" />}
              确认申请，接受规则
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!bindTarget} onOpenChange={(o) => !o && setBindTarget(null)}>
        <DialogContent className="max-w-md">
          {bindTarget && (
            <>
              <DialogHeader>
                <DialogTitle>绑定{BINDING_META[bindTarget].label}</DialogTitle>
                <DialogDescription>{data.platforms?.[bindTarget]?.hint || '请输入账号信息'}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="bind-handle">{BINDING_META[bindTarget].label}账号</Label>
                <Input
                  id="bind-handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.trim())}
                  placeholder={bindTarget === 'qq' ? '例如 49179369' : bindTarget === 'wechat' ? '例如 shuying_lanshan' : '例如 xiaohongshu_id'}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setBindTarget(null)}>取消</Button>
                <Button onClick={doBind} disabled={binding || !handle}>
                  {binding && <Loader2 className="size-3.5 animate-spin" />} 确认绑定
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 头像上传（需审核） */}
      <Dialog open={avatarOpen} onOpenChange={(o) => { if (!o) { setAvatarOpen(false); setAvatarFile(null); setAvatarPreview(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>更换头像</DialogTitle>
            <DialogDescription>
              提交后需管理员审核，通过后才会生效。支持 JPG / PNG / WEBP，建议正方形、2MB 以内。
            </DialogDescription>
          </DialogHeader>

          {avatarData?.pending ? (
            <div className="rounded-xl border border-amber-300/25 bg-amber-400/[0.08] p-3 text-[12px] leading-relaxed text-amber-200">
              你已有一条头像申请正在审核中，请等待审核结果后再提交新的申请。
            </div>
          ) : (
            <div className="space-y-3">
              <div
                onClick={() => avatarInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-6 transition hover:border-violet-300/40"
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="预览" className="size-24 rounded-full object-cover ring-2 ring-white/15" />
                ) : (
                  <div className="grid size-14 place-items-center rounded-full border border-white/10 bg-white/[0.05]">
                    <ImageUp className="size-5 text-violet-200" />
                  </div>
                )}
                <div className="text-[12.5px] text-slate-300">
                  {avatarFile ? avatarFile.name : '点击选择图片'}
                </div>
                <div className="text-[10.5px] text-slate-500">
                  {avatarFile ? `${(avatarFile.size / 1024).toFixed(0)} KB` : '最大 2MB · JPG / PNG / WEBP'}
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    if (f.size > 2 * 1024 * 1024) return toast.error('头像不能超过 2MB');
                    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) {
                      return toast.error('仅支持 JPG / PNG / WEBP');
                    }
                    setAvatarFile(f);
                    setAvatarPreview(URL.createObjectURL(f));
                  }}
                />
              </div>

              <div className="flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-2.5 text-[10.5px] leading-relaxed text-slate-500">
                <ShieldCheck className="mt-0.5 size-3 shrink-0 text-emerald-300/70" />
                <span>图片会做格式校验、SHA-256 指纹记录与安全存储；审核通过前不会替换你的现有头像。</span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAvatarOpen(false)}>取消</Button>
            <Button
              disabled={avatarBusy || !avatarFile || Boolean(avatarData?.pending)}
              onClick={async () => {
                if (!avatarFile) return;
                setAvatarBusy(true);
                try {
                  const form = new FormData();
                  form.append('image', avatarFile);
                  await api.post('/me/avatar', form);
                  toast.success('头像申请已提交', { description: '管理员审核通过后即会生效' });
                  setAvatarOpen(false);
                  setAvatarFile(null);
                  setAvatarPreview('');
                  const fresh = await api.get<any>('/me/avatar');
                  setAvatarData(fresh);
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : '提交失败');
                } finally {
                  setAvatarBusy(false);
                }
              }}
            >
              {avatarBusy ? <Loader2 className="size-4 animate-spin" /> : <ImageUp className="size-4" />} 提交审核
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 修改手机号 */}
      <Dialog open={phoneOpen} onOpenChange={setPhoneOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>修改手机号</DialogTitle>
            <DialogDescription>手机号可用于登录与找回账号，修改需验证登录密码。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new-phone">新手机号</Label>
              <Input
                id="new-phone"
                value={phoneValue}
                onChange={(e) => setPhoneValue(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="请输入 11 位手机号"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone-pwd">登录密码</Label>
              <Input
                id="phone-pwd"
                type="password"
                value={phonePassword}
                onChange={(e) => setPhonePassword(e.target.value)}
                placeholder="用于确认身份"
                autoComplete="current-password"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPhoneOpen(false)}>取消</Button>
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  const res = await api.post<{ user: User }>('/me/phone', {
                    phone: phoneValue,
                    password: phonePassword,
                  });
                  setUser(res.user);
                  setData((d) => (d ? { ...d, user: res.user } : d));
                  setPhoneOpen(false);
                  toast.success('手机号已更新');
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : '修改失败');
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />} 确认修改
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 修改密码 */}
      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>修改登录密码</DialogTitle>
            <DialogDescription>新密码至少 8 位，且同时包含字母与数字。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="pwd-cur">当前密码</Label>
              <Input id="pwd-cur" type="password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pwd-next">新密码</Label>
              <Input id="pwd-next" type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pwd-confirm">确认新密码</Label>
              <Input id="pwd-confirm" type="password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPwdOpen(false)}>取消</Button>
            <Button onClick={changePwd} disabled={saving}>
              {saving && <Loader2 className="size-3.5 animate-spin" />} 确认修改
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  desc,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="glass flex flex-col items-center gap-4 rounded-3xl px-6 py-14 text-center">
      <div className="grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
        <Icon className="size-6 text-slate-400" />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-base font-medium text-white">{title}</h3>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-slate-500">{desc}</p>
      </div>
      {action}
    </div>
  );
}
