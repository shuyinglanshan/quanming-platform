import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  CheckCheck,
  CircleAlert,
  ExternalLink,
  FileImage,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Pager } from './pager';
import { api, ApiError, type Claim } from '@/lib/api';
import { cn, formatDate, relativeTime, STATUS_TEXT } from '@/lib/utils';

const TABS = [
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已驳回' },
  { key: 'all', label: '全部' },
];

const QUICK_REASONS = [
  '材料截图未能清晰展示账号昵称与 UID，请补充完整的个人主页截图后重新提交。',
  '证明材料与所申请的圈名不一致，请上传包含该圈名的作品或主页记录。',
  '材料涉嫌盗用他人截图，无法确认归属，请提供更多可验证的使用记录。',
  '该圈名存在争议，请加入交流群联系管理员说明情况。',
];

export function ClaimsPanel({ onChanged }: { onChanged?: () => void }) {
  const [tab, setTab] = useState('pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Claim[]; total: number; pages: number; counts: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Claim | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Claim | null>(null);
  const [reason, setReason] = useState('');
  const [batchReject, setBatchReject] = useState(false);
  const [acting, setActing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: tab, q, page: String(page), pageSize: '8' });
      const res = await api.get<any>(`/admin/claims?${params}`);
      setData(res);
      setSelected([]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tab, q, page]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (claim: Claim) => {
    setActing(true);
    try {
      const res = await api.post<any>(`/admin/claims/${claim.id}/approve`, {});
      toast.success(`「${claim.name}」审核通过`, {
        description: res.autoRejected ? `同时自动驳回了 ${res.autoRejected} 条同名申请` : '已加入圈名广场',
      });
      setDetail(null);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing(false);
    }
  };

  const reject = async () => {
    if (!rejectTarget) return;
    if (reason.trim().length < 2) return toast.error('请填写拒绝理由（至少 2 个字）');
    setActing(true);
    try {
      await api.post(`/admin/claims/${rejectTarget.id}/reject`, { reason: reason.trim() });
      toast.success('已驳回该申请', { description: '用户可在个人中心看到驳回理由' });
      setRejectTarget(null);
      setDetail(null);
      setReason('');
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing(false);
    }
  };

  const runBatch = async (action: 'approve' | 'reject') => {
    if (selected.length === 0) return toast.error('请先勾选申请');
    if (action === 'reject') {
      setBatchReject(true);
      setReason('');
      return;
    }
    setActing(true);
    try {
      const res = await api.post<any>('/admin/claims/batch', { ids: selected, action });
      toast.success(`批量通过完成`, { description: `成功 ${res.done} 条，跳过 ${res.skipped} 条` });
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing(false);
    }
  };

  const submitBatchReject = async () => {
    if (reason.trim().length < 2) return toast.error('请填写批量驳回理由');
    setActing(true);
    try {
      const res = await api.post<any>('/admin/claims/batch', { ids: selected, action: 'reject', reason: reason.trim() });
      toast.success('批量驳回完成', { description: `成功 ${res.done} 条，跳过 ${res.skipped} 条` });
      setBatchReject(false);
      setReason('');
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing(false);
    }
  };

  const toggleAll = () => {
    const pendingIds = (data?.items || []).filter((c) => c.status === 'pending').map((c) => c.id);
    setSelected((prev) => (prev.length === pendingIds.length ? [] : pendingIds));
  };

  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key);
                  setPage(1);
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition',
                  tab === t.key ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200',
                )}
              >
                {t.label}
                {data?.counts && (
                  <span className={cn('rounded px-1 text-[10px]', tab === t.key ? 'bg-white/15 text-slate-100' : 'bg-white/5 text-slate-500')}>
                    {data.counts[t.key] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="搜索圈名 / 邮箱 / 昵称"
              className="h-9 pl-8 text-[12.5px]"
            />
          </div>
          <Button variant="secondary" size="sm" className="h-9" onClick={load}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> 刷新
          </Button>
        </div>

        {selected.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/[0.08] px-3 py-2">
            <span className="text-[12px] text-violet-100">已选择 {selected.length} 条待审申请</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="success" className="h-7" disabled={acting} onClick={() => runBatch('approve')}>
                <CheckCheck className="size-3.5" /> 批量通过
              </Button>
              <Button size="sm" variant="destructive" className="h-7" disabled={acting} onClick={() => runBatch('reject')}>
                <X className="size-3.5" /> 批量驳回
              </Button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-2">
          {tab === 'pending' && data.items.some((c) => c.status === 'pending') && (
            <button
              onClick={toggleAll}
              className="flex items-center gap-2 px-1 text-[11.5px] text-slate-500 transition hover:text-slate-300"
            >
              <Checkbox checked={selected.length > 0 && selected.length === data.items.filter((c) => c.status === 'pending').length} />
              全选本页待审申请
            </button>
          )}

          {data.items.map((c) => (
            <div key={c.id} className="glass-soft group flex flex-col gap-3 rounded-2xl p-4 transition hover:border-white/16 sm:flex-row">
              <div className="flex items-start gap-3">
                {c.status === 'pending' && (
                  <Checkbox
                    checked={selected.includes(c.id)}
                    onCheckedChange={(v) =>
                      setSelected((prev) => (v ? [...prev, c.id] : prev.filter((id) => id !== c.id)))
                    }
                    className="mt-1"
                  />
                )}
                <button
                  onClick={() => setDetail(c)}
                  className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40"
                >
                  {c.images[0] ? (
                    <img src={c.images[0].url} alt={c.name} className="size-full object-cover transition group-hover:scale-105" />
                  ) : (
                    <FileImage className="m-auto size-6 text-slate-600" />
                  )}
                  <span className="absolute right-0 bottom-0 rounded-tl-md bg-black/70 px-1.5 py-0.5 text-[9.5px] text-slate-300">
                    {c.images.length} 张
                  </span>
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setDetail(c)} className="text-[15px] font-medium text-white hover:text-violet-200">
                    {c.name}
                  </button>
                  <Badge variant={c.status === 'approved' ? 'success' : c.status === 'pending' ? 'warning' : 'danger'}>
                    {STATUS_TEXT[c.status]}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-1 text-[12px] text-slate-400">{c.description || '未填写简介'}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span className="text-slate-400">{c.user?.nickname}</span>
                  <span className="size-1 rounded-full bg-slate-700" />
                  <span>{c.user?.email}</span>
                  <span className="size-1 rounded-full bg-slate-700" />
                  <span>{relativeTime(c.createdAt)}提交</span>
                  {c.reviewedAt && (
                    <>
                      <span className="size-1 rounded-full bg-slate-700" />
                      <span>{formatDate(c.reviewedAt, true)} 审核</span>
                    </>
                  )}
                </div>
                {c.status === 'rejected' && c.rejectReason && (
                  <p className="mt-2 line-clamp-1 rounded-lg bg-rose-400/[0.08] px-2 py-1 text-[11px] text-rose-200/90">
                    驳回：{c.rejectReason}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5 sm:flex-col sm:items-stretch">
                {c.status === 'pending' ? (
                  <>
                    <Button size="sm" variant="success" className="h-8" disabled={acting} onClick={() => approve(c)}>
                      <Check className="size-3.5" /> 通过
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-rose-300 hover:bg-rose-500/10"
                      onClick={() => {
                        setRejectTarget(c);
                        setReason('');
                      }}
                    >
                      <X className="size-3.5" /> 驳回
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="secondary" className="h-8" onClick={() => setDetail(c)}>
                    查看详情
                  </Button>
                )}
              </div>
            </div>
          ))}

          <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />
        </div>
      ) : (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl py-14 text-center">
          <div className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <ShieldCheck className="size-5 text-emerald-300" />
          </div>
          <p className="text-[13px] text-slate-400">当前筛选条件下没有申请记录</p>
        </div>
      )}

      {/* 详情 */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {detail.name}
                  <Badge variant={detail.status === 'approved' ? 'success' : detail.status === 'pending' ? 'warning' : 'danger'}>
                    {STATUS_TEXT[detail.status]}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  {detail.user?.nickname} · {detail.user?.email} · 提交于 {formatDate(detail.createdAt, true)}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-2.5 text-[12px] sm:grid-cols-4">
                {[
                  { k: '归属绑定', v: detail.nameId ? '已绑定' : '待绑定' },
                  { k: '材料数量', v: `${detail.images.length} 张` },
                  { k: '用户注册', v: formatDate(detail.user?.createdAt) },
                  { k: '申请编号', v: detail.id.slice(0, 12) },
                ].map((i) => (
                  <div key={i.k} className="rounded-xl border border-white/8 bg-white/[0.04] p-2.5">
                    <div className="text-[10.5px] text-slate-500">{i.k}</div>
                    <div className="mt-0.5 truncate text-slate-200">{i.v}</div>
                  </div>
                ))}
              </div>

              <div>
                <div className="mb-1.5 text-[11.5px] text-slate-500">圈名简介</div>
                <p className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[12.5px] leading-relaxed text-slate-300">
                  {detail.description || '未填写简介'}
                </p>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-slate-500">
                  <span>归属权证明材料</span>
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
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-1 text-left text-[10px] text-slate-300">
                        {img.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {detail.status === 'rejected' && detail.rejectReason && (
                <div className="rounded-xl border border-rose-300/20 bg-rose-400/[0.08] p-3 text-[12px] leading-relaxed text-rose-200">
                  <div className="mb-1 flex items-center gap-1.5 font-medium">
                    <CircleAlert className="size-3.5" /> 驳回理由
                  </div>
                  {detail.rejectReason}
                </div>
              )}

              {detail.status === 'pending' ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="outline"
                    className="text-rose-300 hover:bg-rose-500/10"
                    onClick={() => {
                      const target = detail;
                      setDetail(null);
                      setRejectTarget(target);
                      setReason('');
                    }}
                  >
                    <X className="size-4" /> 驳回并填写理由
                  </Button>
                  <Button variant="success" disabled={acting} onClick={() => approve(detail)}>
                    {acting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} 通过并绑定归属
                  </Button>
                </div>
              ) : (
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[12px] text-slate-400">
                  审核人：{detail.reviewer || '—'} · 审核时间：{formatDate(detail.reviewedAt, true)}
                  {detail.nameId && <span className="ml-2 text-emerald-300">已绑定圈名</span>}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 驳回 */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>驳回「{rejectTarget?.name}」的归属申请</DialogTitle>
            <DialogDescription>拒绝理由会展示给申请用户，请尽量说明清楚需要补充什么材料。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">
              拒绝理由 <span className="text-rose-300">*</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 300))}
              placeholder="例如：截图中未能清晰展示账号昵称与 UID，请补充完整的个人主页截图。"
              className="min-h-24"
            />
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REASONS.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setReason(r)}
                  className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1 text-[10.5px] text-slate-400 transition hover:border-violet-300/30 hover:text-violet-200"
                >
                  常用理由 {i + 1}
                </button>
              ))}
            </div>
            <div className="text-right text-[11px] text-slate-500">{reason.length}/300</div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejectTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={acting} onClick={reject}>
              {acting ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} 确认驳回
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 批量驳回 */}
      <Dialog open={batchReject} onOpenChange={setBatchReject}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>批量驳回 {selected.length} 条申请</DialogTitle>
            <DialogDescription>同一条拒绝理由将应用到所有选中的申请，用户可在个人中心查看。</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 300))}
            placeholder="请填写拒绝理由…"
            className="min-h-24"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBatchReject(false)}>
              取消
            </Button>
            <Button variant="destructive" disabled={acting} onClick={submitBatchReject}>
              {acting ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} 确认批量驳回
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 图片预览 */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl p-3">
          {preview && (
            <>
              <img src={preview} alt="材料预览" className="max-h-[76vh] w-full rounded-xl object-contain" />
              <a
                href={preview}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 text-[12px] text-violet-300 hover:text-violet-200"
              >
                在新标签页打开原图 <ExternalLink className="size-3" />
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
