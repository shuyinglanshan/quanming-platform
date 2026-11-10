import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, MoreHorizontal, RefreshCw, Search, Sparkles, Trash2,
  CheckCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pager } from './pager';
import { api, ApiError, type NameItem } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

type Row = NameItem & { status: string; ownerEmail: string };

export function NamesPanel({ onChanged }: { onChanged?: () => void }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  // 批量选择
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Row[]; total: number; pages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [delTarget, setDelTarget] = useState<Row | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, status, page: String(page), pageSize: '10' });
      const res = await api.get<any>(`/admin/names?${params}`);
      setData(res);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [q, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (row: Row) => {
    setActing(true);
    try {
      await api.patch(`/admin/names/${row.id}`, { status: row.status === 'active' ? 'hidden' : 'active' });
      toast.success(row.status === 'active' ? '已下架该圈名' : '已恢复展示');
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
      await api.del(`/admin/names/${delTarget.id}`);
      toast.success('圈名已删除');
      setDelTarget(null);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败');
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-4">
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">展示中</SelectItem>
            <SelectItem value="hidden">已下架</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="搜索圈名"
            className="h-9 pl-8 text-[12.5px]"
          />
        </div>
        <Button variant="secondary" size="sm" className="h-9" onClick={load}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> 刷新
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-2">
          {/* 全选 + 批量操作 */}
          {data.items.length > 0 && (
            <div className="glass flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  const ids = data.items.map((n) => n.id);
                  const all = ids.length > 0 && ids.every((id) => selected.includes(id));
                  setSelected(all ? [] : ids);
                }}
                className="flex items-center gap-2 text-[12px] text-slate-400 transition hover:text-white"
              >
                <Checkbox
                  checked={data.items.length > 0 && data.items.every((n) => selected.includes(n.id))}
                />
                全选本页（{data.items.length} 条）
              </button>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                {selected.length > 0 && (
                  <span className="text-[11.5px] text-violet-200">已选 {selected.length} 条</span>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7"
                  disabled={acting || selected.length === 0}
                  title="批量下架选中的圈名"
                  onClick={async () => {
                    setActing(true);
                    try {
                      const res = await api.post<{ done: number; skipped: number }>('/admin/names/batch-status', {
                        ids: selected,
                        status: 'hidden',
                      });
                      toast.success('批量下架完成', { description: `成功 ${res.done} 条，跳过 ${res.skipped} 条` });
                      setSelected([]);
                      load();
                      onChanged?.();
                    } catch (err) {
                      toast.error(err instanceof ApiError ? err.message : '操作失败');
                    } finally {
                      setActing(false);
                    }
                  }}
                >
                  <EyeOff className="size-3.5" /> 批量下架
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7"
                  disabled={acting || selected.length === 0}
                  title="批量恢复展示"
                  onClick={async () => {
                    setActing(true);
                    try {
                      const res = await api.post<{ done: number; skipped: number }>('/admin/names/batch-status', {
                        ids: selected,
                        status: 'active',
                      });
                      toast.success('批量恢复完成', { description: `成功 ${res.done} 条，跳过 ${res.skipped} 条` });
                      setSelected([]);
                      load();
                      onChanged?.();
                    } catch (err) {
                      toast.error(err instanceof ApiError ? err.message : '操作失败');
                    } finally {
                      setActing(false);
                    }
                  }}
                >
                  <Eye className="size-3.5" /> 批量恢复
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7"
                  disabled={acting || selected.length === 0}
                  title="批量删除圈名（不可恢复）"
                  onClick={async () => {
                    if (!confirm(`确定删除选中的 ${selected.length} 个圈名吗？此操作不可恢复。`)) return;
                    setActing(true);
                    try {
                      const res = await api.post<{ done: number }>('/admin/names/batch-delete', { ids: selected });
                      toast.success(`已删除 ${res.done} 个圈名`);
                      setSelected([]);
                      load();
                      onChanged?.();
                    } catch (err) {
                      toast.error(err instanceof ApiError ? err.message : '操作失败');
                    } finally {
                      setActing(false);
                    }
                  }}
                >
                  <CheckCheck className="size-3.5" /> 批量删除
                </Button>
              </div>
            </div>
          )}

          {data.items.map((n) => (
            <div key={n.id} className="glass-soft flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
              <Checkbox
                checked={selected.includes(n.id)}
                onCheckedChange={(v) =>
                  setSelected((prev) => (v ? [...prev, n.id] : prev.filter((id) => id !== n.id)))
                }
                className="shrink-0"
              />
              <div
                className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/12 text-[13px] font-semibold text-white"
                style={{
                  background: `linear-gradient(135deg, hsl(${n.owner?.avatarHue ?? 260} 70% 52%), hsl(${((n.owner?.avatarHue ?? 260) + 50) % 360} 74% 42%))`,
                }}
              >
                {n.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-white">{n.name}</span>
                  <Badge variant={n.status === 'active' ? 'success' : 'secondary'}>
                    {n.status === 'active' ? '展示中' : '已下架'}
                  </Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                  <span>{n.owner?.nickname || '未知'} · {n.ownerEmail}</span>
                  <span className="size-1 rounded-full bg-slate-700" />
                  <span>通过于 {formatDate(n.approvedAt)}</span>
                  <span className="size-1 rounded-full bg-slate-700" />
                  <span>{n.views} 次浏览</span>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => toggle(n)} disabled={acting}>
                    {n.status === 'active' ? <EyeOff /> : <Eye />}
                    {n.status === 'active' ? '下架圈名' : '恢复展示'}
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="danger" onSelect={() => setDelTarget(n)}>
                    <Trash2 /> 删除圈名
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />
        </div>
      ) : (
        <div className="glass flex flex-col items-center gap-2 rounded-2xl py-14 text-center">
          <Sparkles className="size-6 text-slate-600" />
          <p className="text-[13px] text-slate-500">暂无圈名记录</p>
        </div>
      )}

      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除圈名「{delTarget?.name}」</DialogTitle>
            <DialogDescription>
              删除后该圈名将从圈名广场移除，且用户可重新申请。若只是暂时不想展示，建议使用「下架」。
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
