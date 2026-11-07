import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Check, Clock3, Gavel, Loader2, RefreshCw, Scale, Search, ShieldCheck, ThumbsUp, Users,
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
import { api, ApiError, type Court } from '@/lib/api';
import { cn, formatDate, relativeTime } from '@/lib/utils';

const STATUS_META: Record<string, { label: string; tone: string }> = {
  pending: { label: '待启动', tone: 'border-white/15 bg-white/5 text-slate-300' },
  running: { label: '提交材料', tone: 'border-sky-300/30 bg-sky-400/10 text-sky-200' },
  voting: { label: '投票中', tone: 'border-violet-300/30 bg-violet-400/12 text-violet-200' },
  closed: { label: '已判决', tone: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200' },
};

export function CourtsPanel({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Court | null>(null);
  const [winnerId, setWinnerId] = useState('');
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<any>(`/admin/courts?status=${status}&page=${page}&pageSize=10`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { load(); }, [load]);

  const open = async (c: Court) => {
    try {
      const res = await api.get<{ court: Court }>(`/court/${c.id}`);
      setDetail(res.court);
      setWinnerId(res.court.winnerId || '');
      setReason('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败');
    }
  };

  const doOverride = async () => {
    if (!detail) return;
    if (!winnerId) return toast.error('请选择胜出方');
    if (reason.trim().length < 2) return toast.error('请填写改判理由');
    setActing(true);
    try {
      const res = await api.post<{ court: Court }>(`/admin/courts/${detail.id}/override`, {
        winnerId,
        reason: reason.trim(),
      });
      setDetail(res.court);
      toast.success('已改判，归属已更新并通知双方');
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '改判失败');
    } finally {
      setActing(false);
    }
  };

  const tabs = [
    { key: 'all', label: '全部', n: data?.counts?.all ?? 0 },
    { key: 'voting', label: '投票中', n: data?.counts?.voting ?? 0 },
    { key: 'closed', label: '已判决', n: data?.counts?.closed ?? 0 },
  ];

  const claimantVotes = (detail?.voteDetails || []).filter((v) => v.side === 'claimant');
  const respondentVotes = (detail?.voteDetails || []).filter((v) => v.side === 'respondent');

  return (
    <div className="space-y-3">
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setStatus(t.key); setPage(1); }}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition',
              status === t.key ? 'bg-white/12 text-white' : 'text-slate-400 hover:bg-white/6',
            )}
          >
            {t.label}
            {t.n > 0 && <span className="rounded bg-white/10 px-1 text-[10px] text-slate-300">{t.n}</span>}
          </button>
        ))}
        <Button size="sm" variant="secondary" className="ml-auto" onClick={load}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> 刷新
        </Button>
      </div>

      {loading ? (
        <div className="glass flex items-center justify-center gap-2 rounded-2xl py-16 text-[13px] text-slate-400">
          <Loader2 className="size-4 animate-spin" /> 加载中…
        </div>
      ) : !data?.items?.length ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl py-16 text-center">
          <Scale className="size-7 text-slate-600" />
          <p className="text-[13px] text-slate-400">暂无小法庭案件</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.items.map((c: Court) => {
            const meta = STATUS_META[c.status];
            return (
              <div key={c.id} className="glass flex flex-col gap-2 rounded-2xl p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13.5px] font-medium text-white">圈名「{c.nameText}」</span>
                    <span className={cn('rounded-full border px-1.5 py-0 text-[10px]', meta.tone)}>{meta.label}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span>主张：{c.claimant?.nickname || '—'}</span>
                    <span>应诉：{c.respondent?.nickname || '—'}</span>
                    <span className="flex items-center gap-1"><ThumbsUp className="size-3" /> {c.votes.claimant}:{c.votes.respondent}（共{c.votes.total}）</span>
                    <span>{relativeTime(c.createdAt)}</span>
                  </div>
                  {c.status === 'closed' && c.verdictReason && (
                    <div className="mt-1 text-[11px] text-emerald-300/80">{c.verdictReason}</div>
                  )}
                </div>
                <Button size="sm" variant="secondary" className="shrink-0" onClick={() => open(c)}>
                  <Gavel className="size-3.5" /> 查看 / 改判
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
        <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 text-[15px]">
                  圈名「{detail.nameText}」
                  <span className={cn('rounded-full border px-1.5 py-0 text-[10px]', STATUS_META[detail.status].tone)}>
                    {STATUS_META[detail.status].label}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  主张方 {detail.claimant?.nickname || '—'} · 应诉方 {detail.respondent?.nickname || '—'} ·
                  共 {detail.votes.total} 票
                </DialogDescription>
              </DialogHeader>

              {/* 双方材料 */}
              <div className="space-y-2">
                <div className="text-[11.5px] text-slate-500">双方提交的材料</div>
                {(detail.statements || []).length === 0 ? (
                  <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-center text-[11.5px] text-slate-500">
                    尚未提交材料
                  </div>
                ) : (
                  (detail.statements || []).map((s) => (
                    <div key={s.id} className={cn(
                      'rounded-xl border p-3',
                      s.side === 'claimant' ? 'border-violet-300/20 bg-violet-400/[0.05]' : 'border-sky-300/20 bg-sky-400/[0.05]',
                    )}>
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className={s.side === 'claimant' ? 'text-violet-300' : 'text-sky-300'}>
                          {s.side === 'claimant' ? '主张方' : '应诉方'}
                        </span>
                        <span className="text-slate-300">{s.user?.nickname}</span>
                        <span className="rounded bg-white/8 px-1 text-[9.5px] text-slate-400">第{s.round}轮</span>
                        <span className="ml-auto text-[10px] text-slate-600">{relativeTime(s.createdAt)}</span>
                      </div>
                      {s.content && <p className="mt-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-slate-300">{s.content}</p>}
                      {s.images?.length > 0 && (
                        <div className="mt-2 grid grid-cols-4 gap-1.5">
                          {s.images.map((img, i) => (
                            <a key={img.url + i} href={img.url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-lg border border-white/10">
                              <img src={img.url} alt={img.name} className="size-full object-cover" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* 投票理由（管理员可见全部） */}
              <div className="space-y-2">
                <div className="text-[11.5px] text-slate-500">投票用户与支持理由</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { label: '支持主张方', list: claimantVotes, tone: 'violet' },
                    { label: '支持应诉方', list: respondentVotes, tone: 'sky' },
                  ].map((g) => (
                    <div key={g.label} className="rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
                      <div className={cn('mb-1.5 flex items-center gap-1 text-[11px]', g.tone === 'violet' ? 'text-violet-300' : 'text-sky-300')}>
                        <Users className="size-3" /> {g.label}（{g.list.length}）
                      </div>
                      {g.list.length === 0 ? (
                        <div className="py-2 text-center text-[11px] text-slate-600">暂无</div>
                      ) : (
                        <div className="max-h-40 space-y-1.5 overflow-y-auto pr-0.5">
                          {g.list.map((v) => (
                            <div key={v.id} className="rounded-lg bg-white/[0.03] px-2 py-1.5">
                              <div className="text-[11px] text-slate-300">{v.user?.nickname}</div>
                              {v.reason && <div className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{v.reason}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 改判 */}
              <div className="rounded-xl border border-amber-300/20 bg-amber-400/[0.06] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium text-amber-200">
                  <ShieldCheck className="size-3.5" /> 管理员改判（防误判）
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: detail.claimant?.id, name: detail.claimant?.nickname, label: '判给主张方' },
                      { id: detail.respondent?.id, name: detail.respondent?.nickname, label: '判给应诉方' },
                    ].map((o) => (
                      <button
                        key={o.label}
                        onClick={() => setWinnerId(o.id || '')}
                        disabled={!o.id}
                        className={cn(
                          'rounded-lg border px-2.5 py-2 text-left text-[11.5px] transition disabled:opacity-40',
                          winnerId === o.id
                            ? 'border-amber-300/50 bg-amber-400/12 text-amber-100'
                            : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20',
                        )}
                      >
                        <div className="font-medium">{o.label}</div>
                        <div className="mt-0.5 truncate text-[10.5px] text-slate-500">{o.name || '—'}</div>
                      </button>
                    ))}
                  </div>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value.slice(0, 500))}
                    placeholder="填写改判理由（会通知争议双方）"
                    className="min-h-16 text-[12px]"
                  />
                  <Button size="sm" onClick={doOverride} disabled={acting} className="w-full">
                    {acting ? <Loader2 className="size-3.5 animate-spin" /> : <Gavel className="size-3.5" />}
                    确认改判
                  </Button>
                  <p className="text-[10.5px] leading-relaxed text-amber-200/70">
                    改判会立即变更圈名归属并通知双方，请谨慎操作。仅在系统按票数判决明显有误时使用。
                  </p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
