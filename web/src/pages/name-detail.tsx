import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  Eye,
  Flag,
  MessagesSquare,
  Share2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { AppealForm } from '@/components/appeal-form';
import { JoinGroupButton } from '@/components/join-group-button';
import { api, ApiError, type NameItem } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useNotifications } from '@/lib/notifications';
import { formatDate, initials, relativeTime } from '@/lib/utils';

export default function NameDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refresh: refreshUnread } = useNotifications();
  const [data, setData] = useState<NameItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [appealOpen, setAppealOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ name: NameItem }>(`/names/${id}`);
      setData(res.name);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-6 h-52 w-full rounded-3xl" />
        <Skeleton className="mt-4 h-40 w-full rounded-3xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="glass grid size-14 place-items-center rounded-2xl">
          <TriangleAlert className="size-6 text-amber-300" />
        </div>
        <h2 className="text-lg font-semibold text-white">{error || '圈名不存在'}</h2>
        <p className="text-[13px] text-slate-400">该圈名可能已被下架或删除，你可以返回圈名广场继续浏览。</p>
        <Button asChild variant="secondary">
          <Link to="/">返回圈名广场</Link>
        </Button>
      </div>
    );
  }

  const isOwner = user?.id === data.owner?.id;
  const hue = data.owner?.avatarHue ?? 260;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-5 flex items-center gap-1.5 text-[12.5px] text-slate-400 transition hover:text-white"
      >
        <ArrowLeft className="size-3.5" /> 返回
      </button>

      {/* 主卡片 */}
      <div className="glass relative overflow-hidden rounded-3xl p-6 sm:p-8">
        {/* 用径向渐变替代 filter: blur()，避免与父级 backdrop-filter 组成合成层导致整卡黑块 */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(28rem 20rem at 100% 0%, hsl(${hue} 80% 55% / 0.22), transparent 70%)`,
          }}
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
          <div
            className="grid size-16 shrink-0 place-items-center rounded-2xl border border-white/15 text-2xl font-semibold text-white shadow-lg"
            style={{ background: `linear-gradient(135deg, hsl(${hue} 72% 52%), hsl(${(hue + 55) % 360} 76% 42%))` }}
          >
            {data.name.slice(0, 1)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{data.name}</h1>
              <Badge variant="success" className="gap-1">
                <BadgeCheck className="size-3" /> 归属已认证
              </Badge>
              {data.openAppeals ? <Badge variant="warning">{data.openAppeals} 条申诉审核中</Badge> : null}
            </div>

            <p className="mt-3 text-[13.5px] leading-relaxed text-slate-300">
              {data.description || '这位圈友还没有写下简介。'}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5" /> 收录于 {formatDate(data.approvedAt)}
              </span>
              <span className="flex items-center gap-1.5">
                <Eye className="size-3.5" /> {data.views} 次浏览
              </span>
              <span className="flex items-center gap-1.5">
                <Sparkles className="size-3.5" /> 最近更新 {relativeTime(data.approvedAt)}
              </span>
            </div>
          </div>
        </div>

        {/* 归属者 */}
        <div className="relative mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.035] p-4">
          <Avatar className="size-10">
            <AvatarFallback
              style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 50) % 360} 75% 45%))` }}
            >
              {initials(data.owner?.nickname)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] tracking-wide text-slate-500">圈名归属</div>
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13.5px] font-medium text-white">{data.owner?.nickname || '未知'}</span>
              {isOwner && <Badge variant="default">这是你</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {data.owner?.bindings.qq && <Badge variant="cyan">QQ</Badge>}
            {data.owner?.bindings.wechat && <Badge variant="success">微信</Badge>}
            {data.owner?.bindings.xiaohongshu && <Badge variant="danger">小红书</Badge>}
          </div>
        </div>

        {/* 操作 */}
        <div className="relative mt-5 flex flex-wrap gap-2">
          {isOwner ? (
            <Button variant="secondary" asChild>
              <Link to="/me?tab=names">
                <ShieldCheck className="size-4" /> 在个人中心管理
              </Link>
            </Button>
          ) : (
            <Button
              onClick={() => {
                if (!user) {
                  navigate(`/login?redirect=${encodeURIComponent(`/names/${data.id}`)}`);
                  return;
                }
                setAppealOpen(true);
              }}
              className="gap-2"
            >
              <Flag className="size-4" /> 发起归属申诉
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              navigator.clipboard?.writeText(`${location.origin}/names/${data.id}`);
              toast.success('详情页链接已复制');
            }}
          >
            <Share2 className="size-4" /> 分享
          </Button>
          <JoinGroupButton variant="outline" className="h-10" />
        </div>
      </div>

      {/* 说明 */}
      <div className="glass-soft mt-4 grid gap-3 rounded-2xl p-5 sm:grid-cols-2">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300/80" />
          <div>
            <div className="text-[12.5px] font-medium text-white">归属认证说明</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">
              该圈名的归属已通过材料人工审核。认证信息包含使用记录、主页截图等，仅在审核流程内部留存。
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <MessagesSquare className="mt-0.5 size-4 shrink-0 text-violet-300/80" />
          <div>
            <div className="text-[12.5px] font-medium text-white">对归属有异议？</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">
              若你认为该圈名归属存在争议，可提交申诉材料。申诉通过后归属将转移至你的账号，并通知原归属账号。
            </p>
          </div>
        </div>
      </div>

      {/* 申诉弹窗 */}
      <Dialog open={appealOpen} onOpenChange={setAppealOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="size-4 text-amber-300" /> 圈名归属申诉
            </DialogTitle>
            <DialogDescription>请如实填写申诉信息并上传证明材料，恶意申诉将被记录。</DialogDescription>
          </DialogHeader>
          <AppealForm
            nameId={data.id}
            name={data.name}
            onSubmitted={() => {
              setAppealOpen(false);
              refreshUnread();
              navigate('/me?tab=appeals');
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
