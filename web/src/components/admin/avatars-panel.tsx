import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  ImageOff,
  Loader2,
  ScanSearch,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Pager } from '@/components/admin/pager';
import { api, ApiError, type AvatarRequest } from '@/lib/api';
import { cn, formatBytes, formatDate, initials, relativeTime } from '@/lib/utils';

type Counts = { all: number; pending: number; approved: number; rejected: number };

const TABS = [
  { key: 'pending', label: '待审核', tone: 'text-amber-200' },
  { key: 'approved', label: '已通过', tone: 'text-emerald-200' },
  { key: 'rejected', label: '已驳回', tone: 'text-rose-200' },
  { key: 'all', label: '全部', tone: 'text-slate-300' },
];

export function AvatarsPanel({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AvatarRequest[]; total: number; pages: number; counts: Counts } | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<AvatarRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AvatarRequest | null>(null);
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, q, page: String(page), pageSize: '12' });
      const res = await api.get<any>(`/admin/avatars?${params}`);
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

  const approve = async (item: AvatarRequest) => {
    setActing(true);
    try {
      await api.post(`/admin/avatars/${item.id}/approve`);
      toast.success(item.targetType === 'name' ? `已通过圈名「${item.targetName || ''}」的图片` : `已通过「${item.user?.nickname}」的头像申请`, { description: item.targetType === 'name' ? '圈名图片已更新，并已通知对方' : '用户头像已更新，并已通知对方' });
      setPreview(null);
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
    if (reason.trim().length < 2) return toast.error('请填写驳回理由（至少 2 个字）');
    setActing(true);
    try {
      await api.post(`/admin/avatars/${rejectTarget.id}/reject`, { reason: reason.trim() });
      toast.success(rejectTarget.targetType === 'name' ? '已驳回该圈名图片' : '已驳回该头像申请', { description: '原图保持不变，并会收到驳回理由' });
      setRejectTarget(null);
      setPreview(null);
      setReason('');
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setActing(false);
    }
  };

  const counts = data?.counts;

  return (
    <div className="space-y-3">
      {/* 工具条 */}
      <div className="glass flex flex-col gap-2.5 rounded-2xl p-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <TabsList className="grid w-full grid-cols-4 sm:flex sm:w-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="min-w-0 px-1.5 text-[11.5px] sm:px-3 sm:text-[13px]">
                <span className={cn('truncate', t.tone)}>{t.label}</span>
                {counts && (
                  <span className="ml-0.5 shrink-0 rounded-full bg-white/10 px-1 text-[9.5px] text-slate-300 sm:ml-1 sm:px-1.5 sm:text-[10px]">
                    {t.key === 'pending' ? counts.pending : t.key === 'approved' ? counts.approved : t.key === 'rejected' ? counts.rejected : counts.all}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="relative w-full sm:w-64">
          <ScanSearch className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="搜索用户名 / 昵称 / 邮箱"
            className="h-9 pl-9 text-[12.5px]"
          />
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass rounded-2xl p-4">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="mt-3 h-3.5 w-24" />
            </div>
          ))}
        </div>
      ) : !data?.items.length ? (
        <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-14 text-center">
          <div className="grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <ImageOff className="size-6 text-slate-500" />
          </div>
          <p className="text-[13px] text-slate-400">
            {status === 'pending' ? '暂无待审核的图片' : '没有符合条件的记录'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((item) => (
            <button
              key={item.id}
              onClick={() => setPreview(item)}
              className="glass group relative flex gap-3 overflow-hidden rounded-2xl p-3 text-left transition hover:border-white/20"
            >
              <div className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                <img src={item.imageUrl} alt="待审图片" className="size-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[9px] text-slate-300">
                  申请图片
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {/* 类型徽标：区分用户头像与圈名图片 */}
                  <Badge
                    variant={item.targetType === 'name' ? 'cyan' : 'secondary'}
                    className="shrink-0 px-1.5 py-0 text-[9.5px]"
                  >
                    {item.targetType === 'name' ? '圈名图片' : '用户头像'}
                  </Badge>
                  <span className="truncate text-[13px] font-medium text-white">
                    {item.targetType === 'name' ? item.targetName || '—' : item.user?.nickname || '未知'}
                  </span>
                  <Badge
                    variant={item.status === 'pending' ? 'warning' : item.status === 'approved' ? 'success' : 'danger'}
                    className="shrink-0 px-1.5 py-0 text-[9.5px]"
                  >
                    {item.status === 'pending' ? '待审核' : item.status === 'approved' ? '已通过' : '已驳回'}
                  </Badge>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-slate-500">
                  {item.targetType === 'name' ? `归属者 @${item.user?.username || '—'}` : `@${item.user?.username || '—'}`}
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-slate-500">
                  <span className="truncate font-mono">{item.imageSha256.slice(0, 10)}…</span>
                  <span className="shrink-0">{formatBytes(item.imageSize)}</span>
                </div>
                <div className="mt-1 text-[10.5px] text-slate-600">{relativeTime(item.createdAt)}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="pt-1">
          <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />
        </div>
      )}

      {/* 预览 + 审核 */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-lg">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-violet-300" /> 图片审核
                </DialogTitle>
                <DialogDescription>支持审核「用户头像」与「圈名图片」。通过后才会生效，驳回时保持原图不变。</DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 text-[10.5px] text-slate-500">申请图片</div>
                  <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                    <img src={preview.imageUrl} alt="申请头像" className="aspect-square w-full object-cover" />
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-[10.5px] text-slate-500">用户当前头像</div>
                  <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20">
                    <Avatar className="size-20">
                      {preview.user?.avatarUrl ? (
                        <AvatarImage src={preview.user.avatarUrl} alt="当前头像" />
                      ) : null}
                      <AvatarFallback
                        className="text-xl"
                        style={{
                          background: `linear-gradient(135deg, hsl(${preview.user?.avatarHue ?? 260} 70% 52%), hsl(${((preview.user?.avatarHue ?? 260) + 50) % 360} 75% 42%))`,
                        }}
                      >
                        {initials(preview.user?.nickname)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-[10.5px] text-slate-500">当前</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                <div className="rounded-xl border border-white/8 bg-white/[0.04] p-2.5">
                  <div className="text-slate-500">申请人</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <UserRound className="size-3 text-slate-400" />
                    <span className="truncate text-slate-200">{preview.user?.nickname}</span>
                  </div>
                  <div className="text-[10.5px] text-slate-500">@{preview.user?.username}</div>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.04] p-2.5">
                  <div className="text-slate-500">提交时间</div>
                  <div className="mt-0.5 text-slate-200">{formatDate(preview.createdAt, true)}</div>
                </div>
                <div className="col-span-2 rounded-xl border border-white/8 bg-white/[0.04] p-2.5">
                  <div className="text-slate-500">SHA-256（文件指纹）</div>
                  <div className="mt-0.5 break-all font-mono text-[10.5px] text-slate-300">{preview.imageSha256}</div>
                </div>
              </div>

              {preview.status === 'rejected' && preview.rejectReason && (
                <div className="rounded-xl border border-rose-300/20 bg-rose-400/[0.08] p-3 text-[12px] text-rose-200">
                  驳回理由：{preview.rejectReason}
                </div>
              )}

              {preview.status === 'pending' && (
                <DialogFooter>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setRejectTarget(preview);
                      setReason('');
                    }}
                    disabled={acting}
                  >
                    <X className="size-4" /> 驳回
                  </Button>
                  <Button variant="success" onClick={() => approve(preview)} disabled={acting}>
                    {acting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} 通过并应用
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 驳回理由 */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>驳回头像申请</DialogTitle>
            <DialogDescription>用户会看到该理由，头像将保持不变。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="avatar-reason">驳回理由</Label>
            <Textarea
              id="avatar-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 200))}
              placeholder="例如：图片含有违规内容，请更换后重新提交"
              className="min-h-20"
            />
            <div className="flex flex-wrap gap-1.5">
              {['图片模糊或分辨率过低', '含有违规/不适宜内容', '非本人真实照片', '请上传正方形图片'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setReason(t)}
                  className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1 text-[10.5px] text-slate-400 transition hover:border-violet-300/30 hover:text-violet-200"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={reject} disabled={acting}>
              {acting ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} 确认驳回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
