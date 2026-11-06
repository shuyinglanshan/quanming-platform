import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Bug, CheckCircle2, Eye, HelpCircle, Lightbulb, Loader2, MessageSquare,
  Reply, Search, ShieldAlert, Trash2, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Pager } from './pager';
import { api, ApiError, type Feedback, type PageResult } from '@/lib/api';
import { cn, formatDate, relativeTime } from '@/lib/utils';

const KIND_ICON: Record<string, any> = {
  bug: Bug, suggestion: Lightbulb, vulnerability: ShieldAlert, other: HelpCircle,
};

const STATUS_META: Record<string, { label: string; tone: string }> = {
  pending: { label: '待处理', tone: 'border-amber-300/30 bg-amber-400/10 text-amber-200' },
  read: { label: '处理中', tone: 'border-sky-300/30 bg-sky-400/10 text-sky-200' },
  replied: { label: '已答复', tone: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200' },
  closed: { label: '已关闭', tone: 'border-white/15 bg-white/5 text-slate-300' },
};

type Counts = { all: number; pending: number; read: number; replied: number; vulnerability: number };

export function FeedbackPanel({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<(PageResult<Feedback> & { counts: Counts }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Feedback | null>(null);
  const [reply, setReply] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, q, page: String(page), pageSize: '10' });
      const res = await api.get<PageResult<Feedback> & { counts: Counts }>(`/admin/feedback?${params}`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [status, q, page]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (f: Feedback) => {
    setDetail(f);
    setReply(f.reply || '');
    // 打开即标记已读（pending → read），并触发通知
    if (f.status === 'pending') {
      try {
        const res = await api.post<{ feedback: Feedback }>(`/admin/feedback/${f.id}/read`);
        setDetail(res.feedback);
        load();
        onChanged?.();
      } catch { /* ignore */ }
    }
  };

  const doReply = async () => {
    if (!detail) return;
    if (reply.trim().length < 2) return toast.error('请填写答复内容（至少 2 个字）');
    setActing(true);
    try {
      const res = await api.post<{ feedback: Feedback }>(`/admin/feedback/${detail.id}/reply`, { reply });
      setDetail(res.feedback);
      toast.success('答复已发送', { description: '用户会收到通知' });
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '答复失败');
    } finally {
      setActing(false);
    }
  };

  const doClose = async () => {
    if (!detail) return;
    setActing(true);
    try {
      await api.post(`/admin/feedback/${detail.id}/close`);
      toast.success('已关闭');
      setDetail(null);
      load(); onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally { setActing(false); }
  };

  const doDelete = async () => {
    if (!detail) return;
    setActing(true);
    try {
      await api.del(`/admin/feedback/${detail.id}`);
      toast.success('已删除');
      setDetail(null);
      load(); onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败');
    } finally { setActing(false); }
  };

  const c = data?.counts;
  const tabs = [
    { key: 'pending', label: '待处理', n: c?.pending ?? 0 },
    { key: 'read', label: '处理中', n: c?.read ?? 0 },
    { key: 'replied', label: '已答复', n: c?.replied ?? 0 },
    { key: 'all', label: '全部', n: c?.all ?? 0 },
  ];

  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setStatus(t.key); setPage(1); }}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition',
                status === t.key ? 'bg-white/12 text-white' : 'text-slate-400 hover:bg-white/6 hover:text-slate-200',
              )}
            >
              {t.label}
              {t.n > 0 && (
                <span className={cn(
                  'rounded-full px-1.5 text-[10px]',
                  t.key === 'pending' ? 'bg-rose-500/90 text-white' : 'bg-white/10 text-slate-300',
                )}>{t.n}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-[12rem] flex-1 sm:max-w-64">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="搜索标题 / 内容 / 用户"
            className="h-9 pl-8 text-[12.5px]"
          />
        </div>
        <Button size="sm" variant="secondary" onClick={load}>刷新</Button>
      </div>

      {loading ? (
        <div className="glass flex items-center justify-center gap-2 rounded-2xl py-16 text-[13px] text-slate-400">
          <Loader2 className="size-4 animate-spin" /> 加载中…
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl py-16 text-center">
          <MessageSquare className="size-7 text-slate-600" />
          <p className="text-[13px] text-slate-400">暂无反馈</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.items.map((f) => {
            const meta = STATUS_META[f.status] || STATUS_META.pending;
            const Icon = KIND_ICON[f.kind] || HelpCircle;
            return (
              <div
                key={f.id}
                className="glass flex flex-col gap-2.5 rounded-2xl p-4 transition hover:border-white/16 sm:flex-row sm:items-start"
              >
                <div className={cn(
                  'mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border',
                  f.kind === 'vulnerability'
                    ? 'border-rose-300/30 bg-rose-400/10 text-rose-200'
                    : f.status === 'pending'
                      ? 'border-amber-300/25 bg-amber-400/10 text-amber-200'
                      : 'border-white/10 bg-white/[0.05] text-slate-300',
                )}>
                  <Icon className="size-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13.5px] font-medium text-white">{f.title}</span>
                    <span className={cn('rounded-full border px-1.5 py-0 text-[10px]', meta.tone)}>{meta.label}</span>
                    <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0 text-[10px] text-slate-400">
                      {f.kindLabel}{f.kindOther ? `·${f.kindOther}` : ''}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-slate-400">{f.content}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-slate-500">
                    <span>{f.user ? f.user.nickname + (f.user.username ? ` (@${f.user.username})` : '') : '匿名用户'}</span>
                    <span>{relativeTime(f.createdAt)}</span>
                    {f.contact && <span>联系方式：{f.contact}</span>}
                    {f.pagePath && <span>来自 {f.pagePath}</span>}
                  </div>
                </div>

                <Button size="sm" variant="secondary" className="shrink-0" onClick={() => openDetail(f)}>
                  <Reply className="size-3.5" /> {f.status === 'replied' ? '查看答复' : '处理'}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {data && data.pages > 1 && (
        <Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
      )}

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 text-[15px]">
                  {detail.title}
                  <span className={cn('rounded-full border px-1.5 py-0 text-[10px]', (STATUS_META[detail.status] || STATUS_META.pending).tone)}>
                    {(STATUS_META[detail.status] || STATUS_META.pending).label}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  {detail.kindLabel}{detail.kindOther ? `（${detail.kindOther}）` : ''} ·
                  {detail.user ? ` ${detail.user.nickname}` : ' 匿名'} · {formatDate(detail.createdAt, true)}
                </DialogDescription>
              </DialogHeader>

              <div className="max-h-56 overflow-y-auto rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[12.5px] leading-relaxed whitespace-pre-wrap text-slate-300">
                {detail.content}
              </div>

              {detail.imageUrl && (
                <a href={detail.imageUrl} target="_blank" rel="noreferrer">
                  <img src={detail.imageUrl} alt="截图" className="max-h-52 w-full rounded-xl border border-white/10 object-contain" />
                </a>
              )}

              {detail.contact && (
                <div className="text-[11.5px] text-slate-400">联系方式：<span className="text-slate-200">{detail.contact}</span></div>
              )}

              <div className="space-y-2">
                <Label htmlFor="fb-reply">答复内容</Label>
                <Textarea
                  id="fb-reply"
                  value={reply}
                  onChange={(e) => setReply(e.target.value.slice(0, 1000))}
                  placeholder="填写处理结果或答复，用户会收到通知"
                  className="min-h-24"
                />
                <div className="text-right text-[10.5px] text-slate-500">{reply.length}/1000</div>
              </div>

              <DialogFooter className="flex-wrap gap-2 sm:justify-between">
                <div className="flex gap-1.5">
                  <Button variant="ghost" size="sm" className="text-rose-300 hover:text-rose-200" onClick={doDelete} disabled={acting}>
                    <Trash2 className="size-3.5" /> 删除
                  </Button>
                  {detail.status !== 'closed' && (
                    <Button variant="ghost" size="sm" onClick={doClose} disabled={acting}>
                      <XCircle className="size-3.5" /> 关闭
                    </Button>
                  )}
                </div>
                <Button onClick={doReply} disabled={acting}>
                  {acting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} 发送答复
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
