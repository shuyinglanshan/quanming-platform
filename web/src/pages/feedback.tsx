import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, Bug, Lightbulb, Loader2, MessageSquare, Send, ShieldAlert,
  CheckCircle2, Clock3, HelpCircle, MessageCircleReply, ImagePlus, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { JoinGroupButton } from '@/components/join-group-button';
import { useAuth } from '@/lib/auth';
import { api, ApiError, type Feedback, type FeedbackKind } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

const KIND_ICON: Record<string, any> = {
  bug: Bug,
  suggestion: Lightbulb,
  vulnerability: ShieldAlert,
  other: HelpCircle,
};

const STATUS_META: Record<string, { label: string; tone: string }> = {
  pending: { label: '待处理', tone: 'border-amber-300/30 bg-amber-400/10 text-amber-200' },
  read: { label: '已读处理中', tone: 'border-sky-300/30 bg-sky-400/10 text-sky-200' },
  replied: { label: '已答复', tone: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200' },
  closed: { label: '已关闭', tone: 'border-white/15 bg-white/5 text-slate-300' },
};

export default function FeedbackPage() {
  const { user } = useAuth();
  const [kinds, setKinds] = useState<FeedbackKind[]>([]);
  const [kind, setKind] = useState('bug');
  const [kindOther, setKindOther] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mine, setMine] = useState<Feedback[]>([]);
  const [detail, setDetail] = useState<Feedback | null>(null);

  useEffect(() => {
    api.get<{ kinds: FeedbackKind[] }>('/feedback/kinds').then((r) => setKinds(r.kinds)).catch(() => {});
  }, []);

  const loadMine = () => {
    if (!user) return;
    api.get<{ items: Feedback[] }>('/feedback/mine').then((r) => setMine(r.items)).catch(() => {});
  };
  useEffect(loadMine, [user]);

  const current = useMemo(() => kinds.find((k) => k.key === kind), [kinds, kind]);

  const pickFile = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    if (!f) {
      setFile(null);
      setPreview('');
      return;
    }
    if (!f.type.startsWith('image/')) return toast.error('请选择图片文件');
    if (f.size > 5 * 1024 * 1024) return toast.error('图片不能超过 5MB');
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (title.trim().length < 2) return toast.error('请填写标题（至少 2 个字）');
    if (content.trim().length < 5) return toast.error('请填写内容（至少 5 个字）');
    if (kind === 'other' && !kindOther.trim()) return toast.error('请填写类型说明');

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('kind', kind);
      form.append('kindOther', kindOther.trim());
      form.append('title', title.trim());
      form.append('content', content.trim());
      form.append('contact', contact.trim());
      form.append('pagePath', location.pathname);
      if (file) form.append('image', file);
      await api.post('/feedback', form);
      toast.success('提交成功', { description: '您的建议已提交，等待管理员处理，请耐心等待。' });
      setTitle('');
      setContent('');
      setKindOther('');
      pickFile(null);
      loadMine();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Link to="/" className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] text-slate-400 transition hover:text-white">
        <ArrowLeft className="size-3.5" /> 返回首页
      </Link>

      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
          <MessageSquare className="size-5 text-violet-300" />
          反馈与漏洞提交
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">
          遇到问题、有产品建议，或发现了安全漏洞，都可以在这里告诉我们。管理员会逐条查看并答复。
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        {/* 提交表单 */}
        <Card className="gap-4 p-5 sm:p-6">
          <div className="space-y-3">
            <Label>反馈类型</Label>
            <div className="grid grid-cols-2 gap-2">
              {kinds.map((k) => {
                const Icon = KIND_ICON[k.key] || HelpCircle;
                const active = kind === k.key;
                return (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => setKind(k.key)}
                    className={cn(
                      'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition',
                      active
                        ? 'border-violet-300/45 bg-violet-400/12 text-white'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20',
                    )}
                  >
                    <Icon className={cn('mt-0.5 size-4 shrink-0', active ? 'text-violet-200' : 'text-slate-500')} />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium">{k.label}</span>
                      <span className="mt-0.5 block text-[10.5px] leading-snug text-slate-500">{k.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {kind === 'other' && (
            <div className="space-y-2">
              <Label htmlFor="fb-other">类型说明 <span className="text-rose-300">*</span></Label>
              <Input
                id="fb-other"
                value={kindOther}
                onChange={(e) => setKindOther(e.target.value.slice(0, 30))}
                placeholder="请说明这是什么类型的反馈"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="fb-title">标题 <span className="text-rose-300">*</span></Label>
            <Input
              id="fb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 80))}
              placeholder={current?.key === 'vulnerability' ? '简要描述漏洞位置' : '一句话概括你的反馈'}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fb-content">详细描述 <span className="text-rose-300">*</span></Label>
            <Textarea
              id="fb-content"
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, 2000))}
              placeholder={
                current?.key === 'vulnerability'
                  ? '请描述复现步骤、影响范围；如涉及敏感信息请不要写入公开内容'
                  : '请尽量描述清楚：发生了什么、你期望的结果、复现步骤等'
              }
              className="min-h-32"
            />
            <div className="text-right text-[11px] text-slate-500">{content.length}/2000</div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fb-contact">联系方式（选填）</Label>
            <Input
              id="fb-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value.slice(0, 60))}
              placeholder="QQ / 微信 / 邮箱，便于我们进一步沟通"
            />
          </div>

          <div className="space-y-2">
            <Label>截图（选填，≤5MB）</Label>
            {preview ? (
              <div className="relative inline-block">
                <img src={preview} alt="预览" className="h-24 rounded-xl border border-white/10 object-cover" />
                <button
                  type="button"
                  onClick={() => pickFile(null)}
                  className="absolute -top-2 -right-2 rounded-full bg-rose-500 p-1 text-white"
                >
                  <X className="size-3" />
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-4 text-[12px] text-slate-400 transition hover:border-violet-300/40 hover:text-violet-200">
                <ImagePlus className="size-4" /> 点击上传截图
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] || null)}
                />
              </label>
            )}
          </div>

          <Button onClick={submit} disabled={submitting} size="lg" className="w-full">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {submitting ? '提交中…' : '提交反馈'}
          </Button>
          {!user && (
            <p className="text-center text-[11px] text-slate-500">
              当前为匿名提交，登录后可在此页查看处理进度与答复
            </p>
          )}
        </Card>

        {/* 我的提交 */}
        <div className="space-y-3">
          <Card className="gap-3 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[13.5px] font-medium text-white">
                <Clock3 className="size-4 text-sky-300" /> 我的提交
              </div>
              <span className="text-[11px] text-slate-500">{mine.length} 条</span>
            </div>

            {!user ? (
              <p className="text-[12px] leading-relaxed text-slate-500">
                登录后可在个人中心查看自己提交的反馈与管理员答复。
              </p>
            ) : mine.length === 0 ? (
              <p className="text-[12px] text-slate-500">还没有提交过反馈。</p>
            ) : (
              <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
                {mine.map((f) => {
                  const meta = STATUS_META[f.status] || STATUS_META.pending;
                  const Icon = KIND_ICON[f.kind] || HelpCircle;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setDetail(f)}
                      className="w-full rounded-xl border border-white/8 bg-white/[0.03] p-3 text-left transition hover:border-white/16 hover:bg-white/[0.06]"
                    >
                      <div className="flex items-start gap-2">
                        <Icon className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-medium text-white">{f.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className={cn('rounded-full border px-1.5 py-0 text-[10px]', meta.tone)}>{meta.label}</span>
                            <span className="text-[10.5px] text-slate-500">{f.kindLabel}</span>
                            <span className="text-[10.5px] text-slate-600">{formatDate(f.createdAt)}</span>
                          </div>
                          {f.reply && (
                            <div className="mt-1.5 flex items-start gap-1 text-[11px] text-emerald-200/90">
                              <MessageCircleReply className="mt-0.5 size-3 shrink-0" />
                              <span className="line-clamp-2">{f.reply}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="gap-3 p-5">
            <div className="flex items-center gap-2 text-[13px] font-medium text-white">
              <ShieldAlert className="size-4 text-amber-300" /> 安全漏洞说明
            </div>
            <p className="text-[11.5px] leading-relaxed text-slate-400">
              发现漏洞请选择「安全漏洞」类型提交，我们会优先处理。请勿在公开渠道披露未修复漏洞，
              也请不要对本站进行压力测试或破坏性操作。
            </p>
            <JoinGroupButton variant="outline" className="w-full justify-center" label="紧急问题加入交流群" />
          </Card>
        </div>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-lg">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-[15px]">
                  {detail.title}
                  <span className={cn('rounded-full border px-1.5 py-0 text-[10px]', (STATUS_META[detail.status] || STATUS_META.pending).tone)}>
                    {(STATUS_META[detail.status] || STATUS_META.pending).label}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  {detail.kindLabel}
                  {detail.kindOther ? `（${detail.kindOther}）` : ''} · {formatDate(detail.createdAt, true)}
                </DialogDescription>
              </DialogHeader>
              <p className="max-h-48 overflow-y-auto rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[12.5px] leading-relaxed whitespace-pre-wrap text-slate-300">
                {detail.content}
              </p>
              {detail.imageUrl && (
                <img src={detail.imageUrl} alt="截图" className="max-h-56 w-full rounded-xl border border-white/10 object-contain" />
              )}
              {detail.reply ? (
                <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/[0.08] p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-emerald-200">
                    <CheckCircle2 className="size-3.5" /> 管理员答复
                  </div>
                  <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-emerald-100/90">{detail.reply}</p>
                  <div className="mt-1.5 text-[10.5px] text-emerald-300/60">
                    {detail.repliedBy} · {formatDate(detail.repliedAt, true)}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-300/20 bg-amber-400/[0.08] p-3 text-[12px] text-amber-200/90">
                  您的建议已提交，等待管理员处理，请耐心等待。
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
