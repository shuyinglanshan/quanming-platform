import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowRightLeft,
  Check,
  Flag,
  Gavel,
  Loader2,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Pager } from './pager';
import { api, ApiError, type Appeal } from '@/lib/api';
import { cn, formatDate, relativeTime } from '@/lib/utils';

const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待处理' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已驳回' },
];

const QUICK_REASONS = [
  '申诉材料时间线晚于原归属者，无法证明在先使用',
  '证明材料与圈名无关，无法确认使用权归属',
  '截图缺少账号主页与 UID，请补充完整截图',
  '原归属账号仍在正常使用该圈名，归属维持不变',
  '双方材料存在争议，请加入交流群进一步沟通',
];

export function AppealsPanel({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Appeal[]; total: number; pages: number; counts: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Appeal | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, q, page: String(page), pageSize: '8' });
      const res = await api.get<any>(`/admin/appeals?${params}`);
      setData(res);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [status, q, page]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = (a: Appeal) => {
    setDetail(a);
    setMode(null);
    setReason('');
    setNote('');
  };

  const submit = async () => {
    if (!detail) return;
    setActing(true);
    try {
      if (mode === 'approve') {
        const res = await api.post<{ autoRejected: number }>(`/admin/appeals/${detail.id}/approve`, { note });
        toast.success('申诉已通过，圈名归属已转移', {
          description: res.autoRejected ? `同时自动驳回 ${res.autoRejected} 条同圈名申诉` : '原归属账号已收到通知',
        });
      } else {
        await api.post(`/admin/appeals/${detail.id}/reject`, { reason });
        toast.success('申诉已驳回', { description: '申诉人已收到通知' });
      }
      setDetail(null);
      setMode(null);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing(false);
    }
  };

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
          <div className="relative ml-auto w-full sm:w-60">
            <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="搜索圈名 / 申诉人 / 原归属邮箱"
              className="h-9 pl-8 text-[12.5px]"
            />
          </div>
          <Button variant="secondary" size="sm" className="h-9" onClick={load}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> 刷新
          </Button>
        </div>
        <p className="mt-2.5 text-[11px] text-slate-500">
          申诉通过后，圈名归属将立即转移至申诉人账号，系统会同时通知申诉人与原归属账号；审核期间归属保持不变。
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-2">
          {data.items.map((a) => (
            <div key={a.id} className="glass-soft flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div
                  className={cn(
                    'mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border',
                    a.status === 'pending'
                      ? 'border-amber-300/25 bg-amber-400/10 text-amber-200'
                      : a.status === 'approved'
                        ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200'
                        : 'border-rose-300/25 bg-rose-400/10 text-rose-200',
                  )}
                >
                  <Gavel className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => openDetail(a)} className="text-[14.5px] font-medium text-white hover:text-violet-200">
                      {a.name}
                    </button>
                    <Badge variant={a.status === 'pending' ? 'warning' : a.status === 'approved' ? 'success' : 'danger'}>
                      {a.status === 'pending' ? '待处理' : a.status === 'approved' ? '已通过' : '已驳回'}
                    </Badge>
                    {a.transfer && <Badge variant="secondary" className="gap-0.5"><ArrowRightLeft className="size-2.5" /> 已转移归属</Badge>}
                  </div>
                  <div className="mt-1 text-[11.5px] text-slate-400">
                    申诉人 <span className="text-slate-200">{a.user?.nickname}</span>（{a.user?.email}）
                    <span className="mx-1.5 text-slate-700">·</span>
                    原归属 <span className="text-slate-300">{a.ownerNickname}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>理由：{a.reason}</span>
                    <span className="size-1 rounded-full bg-slate-700" />
                    <span>{a.images.length} 张材料</span>
                    <span className="size-1 rounded-full bg-slate-700" />
                    <span>{relativeTime(a.createdAt)}提交</span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => openDetail(a)}>
                  查看材料
                </Button>
                {a.status === 'pending' && (
                  <Button size="sm" variant="success" onClick={() => { openDetail(a); setMode('approve'); }}>
                    <Check className="size-3.5" /> 通过
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />
        </div>
      ) : (
        <div className="glass flex flex-col items-center gap-2 rounded-2xl py-14 text-center">
          <Flag className="size-6 text-slate-600" />
          <p className="text-[13px] text-slate-500">暂无申诉记录</p>
        </div>
      )}

      {/* 详情 / 处理 */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {detail.name} · 归属申诉
                  <Badge variant={detail.status === 'pending' ? 'warning' : detail.status === 'approved' ? 'success' : 'danger'}>
                    {detail.status === 'pending' ? '待处理' : detail.status === 'approved' ? '已通过' : '已驳回'}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  申诉人 {detail.user?.nickname}（{detail.user?.email}） · 提交于 {formatDate(detail.createdAt, true)}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-2.5 text-[12px] sm:grid-cols-4">
                {[
                  { k: '原归属者', v: detail.ownerNickname },
                  { k: '材料数量', v: `${detail.images.length} 张` },
                  { k: '申诉人注册', v: formatDate(detail.user?.createdAt) },
                  { k: '申诉编号', v: detail.id.slice(0, 12) },
                ].map((i) => (
                  <div key={i.k} className="rounded-xl border border-white/8 bg-white/[0.04] p-2.5">
                    <div className="text-[10.5px] text-slate-500">{i.k}</div>
                    <div className="mt-0.5 truncate text-slate-200">{i.v}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-amber-300/15 bg-amber-400/[0.06] p-3 text-[12px] leading-relaxed text-amber-200/90">
                <div className="mb-0.5 font-medium">申诉类型：{detail.reason}</div>
                <div className="text-amber-100/80">通过后归属将转移至申诉人，并通知原归属账号。</div>
              </div>

              <div>
                <div className="mb-1.5 text-[11.5px] text-slate-500">补充说明</div>
                <p className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[12.5px] leading-relaxed whitespace-pre-wrap text-slate-300">
                  {detail.description || '未填写补充说明'}
                </p>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-slate-500">
                  <span>申诉证明材料</span>
                  <span>点击图片可查看原图</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {detail.images.map((img, i) => (
                    <button
                      key={i}
                      onClick={() => setPreview(img.url)}
                      className="group relative overflow-hidden rounded-xl border border-white/10"
                    >
                      <img src={img.url} alt={img.name} className="h-32 w-full object-cover transition group-hover:scale-105" />
                      <span className="absolute right-0 bottom-0 left-0 truncate bg-black/65 px-2 py-1 text-left text-[9.5px] text-slate-300">
                        {img.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {detail.status === 'rejected' && detail.rejectReason && (
                <div className="rounded-xl border border-rose-300/20 bg-rose-400/[0.08] p-3 text-[12px] leading-relaxed text-rose-200">
                  <div className="mb-1 font-medium">驳回理由</div>
                  {detail.rejectReason}
                </div>
              )}

              {detail.status === 'pending' && (
                <>
                  {mode === 'reject' && (
                    <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <Label htmlFor="reject-reason" className="text-rose-200">
                        驳回理由 <span className="text-rose-300">*</span>
                      </Label>
                      <Textarea
                        id="reject-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value.slice(0, 300))}
                        placeholder="请填写驳回理由，申诉人会在通知中看到该理由…"
                        className="min-h-20"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {QUICK_REASONS.map((r, i) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setReason(r)}
                            className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10.5px] text-slate-400 transition hover:border-rose-300/30 hover:text-rose-200"
                          >
                            常用理由 {i + 1}
                          </button>
                        ))}
                      </div>
                      <div className="text-right text-[10.5px] text-slate-500">{reason.length}/300</div>
                    </div>
                  )}

                  {mode === 'approve' && (
                    <div className="space-y-2 rounded-xl border border-emerald-300/20 bg-emerald-400/[0.06] p-3">
                      <Label htmlFor="approve-note" className="text-emerald-200">审核备注（选填）</Label>
                      <Textarea
                        id="approve-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value.slice(0, 300))}
                        placeholder="例如：材料时间线充分，确认申诉人在先使用…"
                        className="min-h-16"
                      />
                      <div className="flex items-start gap-2 text-[11px] leading-relaxed text-emerald-100/80">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                        确认后圈名归属将立即转移，此操作会写入访问日志并通知双方。
                      </div>
                    </div>
                  )}

                  <DialogFooter className="gap-2">
                    {mode === null ? (
                      <>
                        <Button variant="secondary" onClick={() => setMode('reject')}>
                          <X className="size-4" /> 驳回并填写理由
                        </Button>
                        <Button variant="success" onClick={() => setMode('approve')}>
                          <Check className="size-4" /> 通过并转移归属
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" onClick={() => setMode(null)}>
                          返回
                        </Button>
                        <Button
                          variant={mode === 'approve' ? 'success' : 'destructive'}
                          disabled={acting || (mode === 'reject' && reason.trim().length < 2)}
                          onClick={submit}
                        >
                          {acting ? <Loader2 className="size-4 animate-spin" /> : mode === 'approve' ? <Check className="size-4" /> : <X className="size-4" />}
                          {mode === 'approve' ? '确认通过并转移' : '确认驳回'}
                        </Button>
                      </>
                    )}
                  </DialogFooter>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 图片预览 */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          {preview && <img src={preview} alt="材料原图" className="max-h-[75vh] w-full rounded-xl object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
