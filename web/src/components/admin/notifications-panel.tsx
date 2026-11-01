import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCheck,
  Loader2,
  Megaphone,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn, relativeTime, initials } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pager } from './pager';
import { api, ApiError, type Notification } from '@/lib/api';

type Row = Notification & { target?: { id: string; nickname: string; email: string } | null };
type Recipient = { id: string; email: string; nickname: string; role: string; avatarHue: number };

const LEVELS = [
  { value: 'info', label: '普通' },
  { value: 'success', label: '成功' },
  { value: 'warning', label: '提醒' },
  { value: 'danger', label: '重要' },
];

export function NotificationsPanel({ onChanged }: { onChanged?: () => void }) {
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Row[]; total: number; pages: number; counts: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState<'broadcast' | 'personal' | null>(null);
  const [delTarget, setDelTarget] = useState<Row | null>(null);
  const [acting, setActing] = useState(false);

  // 表单
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [level, setLevel] = useState('info');
  const [link, setLink] = useState('');
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [picked, setPicked] = useState<Recipient[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type, q, page: String(page), pageSize: '10' });
      const res = await api.get<any>(`/admin/notifications?${params}`);
      setData(res);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [type, q, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (compose !== 'personal') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ items: Recipient[] }>(
          `/admin/notifications/recipients?q=${encodeURIComponent(recipientQuery)}`,
        );
        if (!cancelled) setRecipients(res.items);
      } catch {
        if (!cancelled) setRecipients([]);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recipientQuery, compose]);

  const openCompose = (mode: 'broadcast' | 'personal') => {
    setCompose(mode);
    setTitle('');
    setContent('');
    setLevel('info');
    setLink('');
    setPicked([]);
    setRecipientQuery('');
  };

  const submit = async () => {
    if (!title.trim()) return toast.error('请填写通知标题');
    if (!content.trim()) return toast.error('请填写通知内容');
    if (compose === 'personal' && picked.length === 0) return toast.error('请选择至少一位接收用户');

    setActing(true);
    try {
      if (compose === 'broadcast') {
        const res = await api.post<{ count: number }>('/admin/notifications/broadcast', {
          title: title.trim(),
          content: content.trim(),
          level,
          link: link.trim() || null,
        });
        toast.success('系统通知已发布', { description: `已送达 ${res.count} 位用户` });
      } else {
        const res = await api.post<{ sent: number }>('/admin/notifications/send', {
          userIds: picked.map((p) => p.id),
          title: title.trim(),
          content: content.trim(),
          level,
          link: link.trim() || null,
        });
        toast.success('通知已发送', { description: `已发送给 ${res.sent} 位用户` });
      }
      setCompose(null);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '发送失败');
    } finally {
      setActing(false);
    }
  };

  const remove = async () => {
    if (!delTarget) return;
    setActing(true);
    try {
      await api.del(`/admin/notifications/${delTarget.id}`);
      toast.success('通知已删除');
      setDelTarget(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败');
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
            {[
              { key: 'all', label: '全部' },
              { key: 'system', label: '系统通知' },
              { key: 'personal', label: '个人通知' },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setType(t.key);
                  setPage(1);
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition',
                  type === t.key ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200',
                )}
              >
                {t.label}
                {data?.counts && (
                  <span className={cn('rounded px-1 text-[10px]', type === t.key ? 'bg-white/15 text-slate-100' : 'bg-white/5 text-slate-500')}>
                    {data.counts[t.key] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="relative ml-auto w-full sm:w-56">
            <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="搜索通知标题 / 内容"
              className="h-9 pl-8 text-[12.5px]"
            />
          </div>
          <Button variant="secondary" size="sm" className="h-9" onClick={load}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> 刷新
          </Button>
          <Button size="sm" className="h-9" onClick={() => openCompose('broadcast')}>
            <Megaphone className="size-3.5" /> 发布系统通知
          </Button>
          <Button size="sm" variant="secondary" className="h-9" onClick={() => openCompose('personal')}>
            <Send className="size-3.5" /> 发送给指定用户
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-2">
          {data.items.map((n) => (
            <div key={n.id} className="glass-soft flex items-start gap-3 rounded-2xl p-4">
              <div
                className={cn(
                  'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border',
                  n.type === 'system'
                    ? 'border-violet-300/25 bg-violet-400/10 text-violet-200'
                    : 'border-cyan-300/25 bg-cyan-400/10 text-cyan-200',
                )}
              >
                {n.type === 'system' ? <Megaphone className="size-3.5" /> : <UserRound className="size-3.5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-medium text-white">{n.title}</span>
                  <Badge variant="secondary" className="px-1.5 py-0 text-[9.5px]">
                    {n.type === 'system' ? '系统' : '个人'}
                  </Badge>
                  <Badge
                    variant={n.level === 'danger' ? 'danger' : n.level === 'warning' ? 'warning' : n.level === 'success' ? 'success' : 'secondary'}
                    className="px-1.5 py-0 text-[9.5px]"
                  >
                    {LEVELS.find((l) => l.value === n.level)?.label || '普通'}
                  </Badge>
                  {n.readAt && (
                    <span className="flex items-center gap-0.5 text-[10px] text-emerald-300/80">
                      <CheckCheck className="size-2.5" /> 已读
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-slate-400">{n.content}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-slate-600">
                  <span>接收：{n.target ? `${n.target.nickname}（${n.target.email}）` : '未知用户'}</span>
                  <span className="size-1 rounded-full bg-slate-700" />
                  <span>{relativeTime(n.createdAt)}</span>
                </div>
              </div>
              <Button variant="ghost" size="icon-sm" className="text-slate-500 hover:text-rose-300" onClick={() => setDelTarget(n)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />
        </div>
      ) : (
        <div className="glass flex flex-col items-center gap-2 rounded-2xl py-14 text-center">
          <Megaphone className="size-6 text-slate-600" />
          <p className="text-[13px] text-slate-500">暂无通知记录</p>
        </div>
      )}

      {/* 发布通知 */}
      <Dialog open={!!compose} onOpenChange={(o) => !o && setCompose(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {compose === 'broadcast' ? <Megaphone className="size-4 text-violet-300" /> : <Send className="size-4 text-cyan-300" />}
              {compose === 'broadcast' ? '发布系统通知' : '发送通知给指定用户'}
            </DialogTitle>
            <DialogDescription>
              {compose === 'broadcast'
                ? '将向当前所有正常注册用户各发送一条系统通知，可在前台「通知中心 - 系统通知」查看。'
                : '选择接收用户后发送个人通知，用户会在通知中心看到。'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {compose === 'personal' && (
              <div className="space-y-2">
                <Label>接收用户</Label>
                <div className="flex flex-wrap gap-1.5">
                  {picked.map((p) => (
                    <span key={p.id} className="flex items-center gap-1 rounded-lg border border-violet-300/30 bg-violet-400/12 px-2 py-1 text-[11px] text-violet-100">
                      {p.nickname}
                      <button onClick={() => setPicked((prev) => prev.filter((x) => x.id !== p.id))}>
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  {picked.length === 0 && <span className="text-[11.5px] text-slate-500">尚未选择用户</span>}
                </div>
                <div className="relative">
                  <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
                  <Input
                    value={recipientQuery}
                    onChange={(e) => setRecipientQuery(e.target.value)}
                    placeholder="搜索邮箱或昵称"
                    className="h-9 pl-8 text-[12.5px]"
                  />
                </div>
                <div className="max-h-36 overflow-y-auto rounded-xl border border-white/8 bg-white/[0.03] p-1">
                  {recipients.length === 0 && <div className="py-4 text-center text-[11.5px] text-slate-500">没有匹配用户</div>}
                  {recipients.map((r) => {
                    const active = picked.some((p) => p.id === r.id);
                    return (
                      <button
                        key={r.id}
                        onClick={() =>
                          setPicked((prev) => (active ? prev.filter((x) => x.id !== r.id) : [...prev, r]))
                        }
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition',
                          active ? 'bg-violet-400/12' : 'hover:bg-white/[0.06]',
                        )}
                      >
                        <Avatar className="size-6">
                          <AvatarFallback className="text-[10px]" style={{ background: `hsl(${r.avatarHue} 65% 45%)` }}>
                            {initials(r.nickname)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate text-[12px] text-slate-200">{r.nickname}</span>
                        <span className="ml-auto truncate text-[10.5px] text-slate-500">{r.email}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="nt-title">
                通知标题 <span className="text-rose-300">*</span>
              </Label>
              <Input id="nt-title" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 60))} placeholder="例如：平台规则更新说明" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nt-content">
                通知内容 <span className="text-rose-300">*</span>
              </Label>
              <Textarea
                id="nt-content"
                value={content}
                onChange={(e) => setContent(e.target.value.slice(0, 1500))}
                placeholder="支持换行，最多 1500 字…"
                className="min-h-28"
              />
              <div className="text-right text-[10.5px] text-slate-500">{content.length}/1500</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>重要级别</Label>
                <Select value={level} onValueChange={setLevel}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nt-link">跳转链接（选填）</Label>
                <Input id="nt-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="/me?tab=claims" className="h-9" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCompose(null)}>取消</Button>
            <Button onClick={submit} disabled={acting}>
              {acting ? <Loader2 className="size-4 animate-spin" /> : compose === 'broadcast' ? <Users className="size-4" /> : <Send className="size-4" />}
              {compose === 'broadcast' ? '发布给全部用户' : `发送给 ${picked.length} 位用户`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除 */}
      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除通知</DialogTitle>
            <DialogDescription>删除后该条通知将从用户的通知中心移除，此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDelTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={remove} disabled={acting}>
              {acting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} 确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
