import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(input?: string | number | null, withTime = false) {
  if (!input) return '—';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}` : base;
}

export function relativeTime(input?: string | number | null) {
  if (!input) return '—';
  const t = new Date(input).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDate(input);
}

export function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function maskEmail(email?: string | null) {
  if (!email) return '—';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(2, Math.min(6, local.length - 2)))}@${domain}`;
}

export function initials(name?: string | null) {
  if (!name) return '圈';
  return name.trim().slice(0, 1).toUpperCase();
}

export const STATUS_TEXT: Record<string, string> = {
  pending: '审核中',
  approved: '已通过',
  rejected: '已驳回',
  active: '正常',
  banned: '已封禁',
};

export const ROLE_META: Record<string, { label: string; tone: string; desc: string }> = {
  admin: {
    label: '管理员',
    tone: 'border-violet-300/30 bg-violet-400/12 text-violet-200',
    desc: '最高权限：审核、申诉、用户与权限组、圈名、日志、通知、系统设置',
  },
  assessor: {
    label: '审核员',
    tone: 'border-cyan-300/30 bg-cyan-400/12 text-cyan-200',
    desc: '可审核圈名归属申请与归属申诉，查看数据概览与访问日志',
  },
  user: {
    label: '普通用户',
    tone: 'border-white/15 bg-white/[0.06] text-slate-300',
    desc: '提交圈名归属申请、申诉、绑定社交账号与查看通知',
  },
};

export function statusTone(status: string) {
  switch (status) {
    case 'approved':
    case 'active':
      return 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200';
    case 'pending':
      return 'border-amber-300/30 bg-amber-400/10 text-amber-200';
    case 'rejected':
    case 'banned':
      return 'border-rose-300/30 bg-rose-400/10 text-rose-200';
    default:
      return 'border-white/15 bg-white/5 text-slate-300';
  }
}

export const BINDING_META = {
  qq: { label: 'QQ', color: 'from-sky-400 to-blue-500', short: 'Q' },
  wechat: { label: '微信', color: 'from-emerald-400 to-green-500', short: '微' },
  xiaohongshu: { label: '小红书', color: 'from-rose-400 to-red-500', short: '红' },
} as const;

export type PlatformKey = keyof typeof BINDING_META;
