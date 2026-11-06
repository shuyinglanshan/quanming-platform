import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Activity,
  Clock3,
  Gauge,
  Gavel,
  LayoutDashboard,
  Mail,
  Megaphone,
  RefreshCw,
  Server,
  ShieldCheck,
  ShieldHalf,
  Sparkles,
  UserRound,
  Users,
  Image as ImageIcon,
  MessageSquare,
  Crown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ClaimsPanel } from '@/components/admin/claims-panel';
import { AppealsPanel } from '@/components/admin/appeals-panel';
import { UsersPanel } from '@/components/admin/users-panel';
import { LogsPanel } from '@/components/admin/logs-panel';
import { NamesPanel } from '@/components/admin/names-panel';
import { NotificationsPanel } from '@/components/admin/notifications-panel';
import { MailPanel } from '@/components/admin/mail-panel';
import { SecurityPanel } from '@/components/admin/security-panel';
import { AvatarsPanel } from '@/components/admin/avatars-panel';
import { FeedbackPanel } from '@/components/admin/feedback-panel';
import { RolesPanel } from '@/components/admin/roles-panel';
import { StatCard, TrendChart, type TrendPoint } from '@/components/admin/trend-chart';
import { api, ApiError, type Claim, type Appeal } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, relativeTime, ROLE_META, STATUS_TEXT } from '@/lib/utils';

type Stats = {
  cards: {
    users: number;
    activeUsers: number;
    banned: number;
    assessors: number;
    newUsers7d: number;
    names: number;
    pending: number;
    approved: number;
    rejected: number;
    appeals: number;
    appealsPending: number;
    avatarsPending: number;
    feedbackPending: number;
    feedbackTotal: number;
    visits: number;
    visits24h: number;
    passRate: number;
    avgReviewHours: number;
    searches: number;
    myReviewed: number;
    blockedIps: number;
    tempBlocked: number;
  };
  role: string;
  trend: TrendPoint[];
  topSearches: { q: string; count: number }[];
  recentLogs: any[];
  recentClaims: Claim[];
  recentAppeals: Appeal[];
};

type NavItem = {
  key: string;
  label: string;
  icon: any;
  permission?: string;
  badge?: (s: Stats | null) => number;
  hint?: string;
};

const NAV: NavItem[] = [
  { key: 'overview', label: '数据概览', icon: LayoutDashboard, permission: 'dashboard' },
  { key: 'claims', label: '归属审核', icon: ShieldCheck, permission: 'review', badge: (s) => s?.cards.pending ?? 0 },
  { key: 'appeals', label: '归属申诉', icon: Gavel, permission: 'appeal', badge: (s) => s?.cards.appealsPending ?? 0 },
  { key: 'avatars', label: '头像审核', icon: ImageIcon, permission: 'users', badge: (s) => s?.cards.avatarsPending ?? 0 },
  { key: 'feedback', label: '反馈处理', icon: MessageSquare, permission: 'feedback', badge: (s) => s?.cards.feedbackPending ?? 0 },
  { key: 'users', label: '用户与权限', icon: Users, permission: 'users' },
  { key: 'roles', label: '角色与功能权限', icon: Crown, permission: 'users' },
  { key: 'names', label: '圈名管理', icon: Sparkles, permission: 'names' },
  { key: 'notifications', label: '通知发布', icon: Megaphone, permission: 'notify' },
  { key: 'mail', label: '邮箱配置', icon: Mail, permission: 'settings' },
  { key: 'security', label: '访问风控', icon: ShieldHalf, permission: 'settings' },
  { key: 'logs', label: '访问日志', icon: Activity, permission: 'logs' },
];

export default function AdminPage() {
  const { user, can } = useAuth();
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.get<Stats>('/admin/stats');
      setStats(res);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '统计数据加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const nav = NAV.filter((n) => !n.permission || can(n.permission));
  const pending = stats?.cards.pending ?? 0;
  const appealsPending = stats?.cards.appealsPending ?? 0;
  const avatarsPending = stats?.cards.avatarsPending ?? 0;
  const roleMeta = ROLE_META[user?.role || 'user'];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
      {/* 顶部 */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] text-slate-500 uppercase">
            <ShieldCheck className="size-3 text-violet-300" /> Admin Console
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-white">管理后台</h1>
            <span className={cn('rounded-full border px-2 py-0.5 text-[10.5px]', roleMeta.tone)}>{roleMeta.label}</span>
          </div>
          <p className="mt-1 max-w-full text-[12.5px] leading-relaxed text-slate-500 line-clamp-2 sm:line-clamp-1">
            <span className="break-all">
              当前登录：{user?.nickname || user?.username}
              {user?.email ? `（${user.email}）` : ''}
            </span>
            <span className="hidden sm:inline"> · {roleMeta.desc}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pending > 0 && (
            <button
              onClick={() => setTab('claims')}
              className="flex items-center gap-1.5 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200 transition hover:bg-amber-400/15"
            >
              <Clock3 className="size-3.5" /> {pending} 条待审核
            </button>
          )}
          {appealsPending > 0 && (
            <button
              onClick={() => setTab('appeals')}
              className="flex items-center gap-1.5 rounded-xl border border-sky-300/25 bg-sky-400/10 px-3 py-2 text-[12px] text-sky-200 transition hover:bg-sky-400/15"
            >
              <Gavel className="size-3.5" /> {appealsPending} 条申诉待处理
            </button>
          )}
          {avatarsPending > 0 && (
            <button
              onClick={() => setTab('avatars')}
              className="flex items-center gap-1.5 rounded-xl border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-[12px] text-rose-200 transition hover:bg-rose-400/15"
            >
              <ImageIcon className="size-3.5" /> {avatarsPending} 个头像待审核
            </button>
          )}
          <Button variant="secondary" size="sm" className="h-9" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} /> 刷新数据
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[210px_1fr]">
        <aside className="glass h-fit min-w-0 rounded-2xl p-2 lg:sticky lg:top-20">
          {/* 移动端横向滚动不换行，标题过长时靠 overflow 滚动而非撑破布局 */}
          <nav className="flex flex-wrap gap-1 pb-0.5 sm:gap-1.5 lg:flex-col lg:flex-nowrap lg:overflow-visible lg:pb-0">
            {nav.map((n) => {
              const count = n.badge?.(stats) ?? 0;
              return (
                <button
                  key={n.key}
                  onClick={() => setTab(n.key)}
                  className={cn(
                    'relative flex min-w-0 items-center gap-1.5 rounded-xl px-2.5 py-2 text-[12px] whitespace-nowrap transition sm:gap-2 sm:px-3 sm:py-2.5 sm:text-[13px]',
                    tab === n.key
                      ? 'bg-gradient-to-r from-violet-500/25 to-indigo-500/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.1)]'
                      : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200',
                  )}
                >
                  <span className="relative">
                    <n.icon className="size-4" />
                    {/* 未读红点：即使数量很多也直观可见 */}
                    {count > 0 && (
                      <span className="absolute -top-1 -right-1 flex size-2">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75" />
                        <span className="relative inline-flex size-2 rounded-full bg-rose-500" />
                      </span>
                    )}
                  </span>
                  <span className="lg:flex-1 lg:text-left">{n.label}</span>
                  {count > 0 && (
                    <span className="ml-0.5 shrink-0 rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] leading-none font-medium text-amber-200 tabular-nums lg:ml-auto">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="mt-2 hidden rounded-xl border border-white/8 bg-white/[0.03] p-3 lg:block">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Server className="size-3" /> 运行状态
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-emerald-300">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> 服务正常
            </div>
            {stats && stats.cards.blockedIps > 0 && (
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-rose-300/80">
                <ShieldHalf className="size-3" /> {stats.cards.blockedIps} 个 IP 已拉黑
              </div>
            )}
            <Link to="/" className="mt-2 block text-[11px] text-slate-500 hover:text-slate-300">
              ← 返回前台
            </Link>
          </div>
        </aside>

        <div className="min-w-0">
          {tab === 'overview' && <Overview stats={stats} loading={loading} onGoto={setTab} role={user?.role || 'user'} />}
          {tab === 'claims' && <ClaimsPanel onChanged={() => load(true)} />}
          {tab === 'appeals' && <AppealsPanel onChanged={() => load(true)} />}
          {tab === 'avatars' && <AvatarsPanel onChanged={() => load(true)} />}
          {tab === 'feedback' && <FeedbackPanel onChanged={() => load(true)} />}
          {tab === 'roles' && <RolesPanel />}
          {tab === 'users' && <UsersPanel onChanged={() => load(true)} currentUserId={user?.id} />}
          {tab === 'names' && <NamesPanel onChanged={() => load(true)} />}
          {tab === 'notifications' && <NotificationsPanel onChanged={() => load(true)} />}
          {tab === 'mail' && <MailPanel />}
          {tab === 'security' && <SecurityPanel />}
          {tab === 'logs' && <LogsPanel />}
        </div>
      </div>
    </div>
  );
}

function Overview({
  stats,
  loading,
  onGoto,
  role,
}: {
  stats: Stats | null;
  loading: boolean;
  onGoto: (k: string) => void;
  role: string;
}) {
  const { can } = useAuth();

  if (loading || !stats) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-52 rounded-2xl" />
          <Skeleton className="h-52 rounded-2xl" />
        </div>
      </div>
    );
  }

  const c = stats.cards;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="注册用户" value={c.users} hint={`近 7 天新增 ${c.newUsers7d} 人`} icon={Users} accent="violet" />
        <StatCard label="已绑定圈名" value={c.names} hint={`累计通过 ${c.approved} 次审核`} icon={Sparkles} accent="cyan" />
        <StatCard label="待审核申请" value={c.pending} hint={`已驳回 ${c.rejected} 条`} icon={Clock3} accent="amber" />
        <StatCard
          label={can('appeal') ? '待处理申诉' : '访问总量'}
          value={can('appeal') ? c.appealsPending : c.visits}
          hint={can('appeal') ? `累计申诉 ${c.appeals} 条` : `24 小时内 ${c.visits24h} 次`}
          icon={can('appeal') ? Gavel : Activity}
          accent={can('appeal') ? 'rose' : 'emerald'}
        />
      </div>

      <div className="glass rounded-2xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[14px] font-medium text-white">平台趋势</h3>
            <p className="mt-0.5 text-[11.5px] text-slate-500">访问、申请与审核通过量的变化</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
            <Badge variant="secondary">通过率 {c.passRate}%</Badge>
            <Badge variant="secondary">平均审核 {c.avgReviewHours} 小时</Badge>
            {role !== 'admin' && <Badge variant="cyan">我处理了 {c.myReviewed} 条</Badge>}
          </div>
        </div>
        <TrendChart data={stats.trend} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="glass rounded-2xl p-5">
          <h3 className="text-[14px] font-medium text-white">搜索热词</h3>
          <p className="mt-0.5 mb-4 text-[11.5px] text-slate-500">用户在前台检索最多的关键词</p>
          <div className="space-y-1.5">
            {stats.topSearches.length === 0 && <p className="text-[12px] text-slate-500">暂无搜索记录</p>}
            {stats.topSearches.slice(0, 6).map((s, i) => (
              <div key={s.q} className="flex items-center gap-2 rounded-lg border border-white/6 bg-white/[0.03] px-2.5 py-1.5">
                <span
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded-md text-[10px]',
                    i === 0 ? 'bg-amber-400/20 text-amber-200' : i === 1 ? 'bg-slate-300/15 text-slate-200' : 'bg-white/8 text-slate-400',
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex-1 truncate text-[12.5px] text-slate-200">{s.q}</span>
                <span className="text-[11px] text-slate-500">{s.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-medium text-white">待审核队列</h3>
            <button onClick={() => onGoto('claims')} className="text-[11.5px] text-violet-300 hover:text-violet-200">
              查看全部
            </button>
          </div>
          <p className="mt-0.5 mb-3 text-[11.5px] text-slate-500">优先处理等待最久的申请</p>
          <div className="space-y-1.5">
            {stats.recentClaims.length === 0 && <p className="text-[12px] text-slate-500">暂无待审核申请 🎉</p>}
            {stats.recentClaims.map((c2) => (
              <button
                key={c2.id}
                onClick={() => onGoto('claims')}
                className="flex w-full items-center gap-2 rounded-lg border border-white/6 bg-white/[0.03] px-2.5 py-1.5 text-left transition hover:border-violet-300/25 hover:bg-violet-400/[0.07]"
              >
                <img src={c2.images[0]?.url} alt="" className="size-7 shrink-0 rounded-md object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-slate-200">{c2.name}</div>
                  <div className="truncate text-[10.5px] text-slate-500">
                    {c2.user?.nickname} · {relativeTime(c2.createdAt)}
                  </div>
                </div>
                <Badge variant="warning" className="shrink-0 px-1.5 py-0 text-[9.5px]">
                  {STATUS_TEXT[c2.status]}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-medium text-white">待处理申诉</h3>
            {can('appeal') && (
              <button onClick={() => onGoto('appeals')} className="text-[11.5px] text-violet-300 hover:text-violet-200">
                查看全部
              </button>
            )}
          </div>
          <p className="mt-0.5 mb-3 text-[11.5px] text-slate-500">申诉通过后归属将转移</p>
          <div className="space-y-1.5">
            {stats.recentAppeals.length === 0 && <p className="text-[12px] text-slate-500">暂无待处理申诉</p>}
            {stats.recentAppeals.map((a) => (
              <button
                key={a.id}
                onClick={() => can('appeal') && onGoto('appeals')}
                className="flex w-full items-center gap-2 rounded-lg border border-white/6 bg-white/[0.03] px-2.5 py-1.5 text-left transition hover:border-sky-300/25 hover:bg-sky-400/[0.07]"
              >
                <Gavel className="size-3.5 shrink-0 text-sky-300/80" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-slate-200">{a.name}</div>
                  <div className="truncate text-[10.5px] text-slate-500">
                    {a.user?.nickname} → 原归属 {a.ownerNickname}
                  </div>
                </div>
                <span className="shrink-0 text-[10px] text-slate-600">{relativeTime(a.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-medium text-white">最近访问</h3>
            <button onClick={() => onGoto('logs')} className="text-[11.5px] text-violet-300 hover:text-violet-200">
              访问日志
            </button>
          </div>
          <div className="mt-3 space-y-1">
            {stats.recentLogs.slice(0, 7).map((l: any) => (
              <div key={l.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[11.5px] hover:bg-white/[0.04]">
                <span className={cn('font-mono text-[10px]', l.status >= 400 ? 'text-rose-300' : 'text-emerald-300')}>{l.status}</span>
                <span className="truncate text-slate-300">{l.action}</span>
                <span className="ml-auto shrink-0 text-[10.5px] text-slate-600">{l.ip}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <h3 className="text-[14px] font-medium text-white">运营提示</h3>
          <div className="mt-3 space-y-2 text-[12px] leading-relaxed text-slate-400">
            <div className="flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
              <span>审核归属时请重点核对截图中的昵称、UID 与申请圈名是否一致；材料模糊时请驳回并说明需补充的内容。</span>
            </div>
            <div className="flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
              <Gavel className="mt-0.5 size-3.5 shrink-0 text-sky-300" />
              <span>
                申诉审核需谨慎：通过后圈名归属立即转移，系统会通知申诉人与原归属账号，并写入访问日志。
              </span>
            </div>
            <div className="flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
              <UserRound className="mt-0.5 size-3.5 shrink-0 text-violet-300" />
              <span>
                共 {c.activeUsers} 个正常账号、{c.assessors} 位审核员、{c.banned} 个封禁账号。封禁会立即失效其登录会话。
              </span>
            </div>
            <div className="flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
              <Gauge className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
              <span>
                风控：{c.blockedIps} 个 IP 永久拉黑、{c.tempBlocked} 个临时限制中，平均审核 {c.avgReviewHours} 小时。
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
