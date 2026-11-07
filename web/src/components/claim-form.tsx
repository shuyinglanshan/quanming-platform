import { useState } from 'react';
import { toast } from 'sonner';
import { CircleAlert, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ImageUploader, type LocalFile } from '@/components/image-uploader';
import { api, ApiError, type Claim } from '@/lib/api';

export function ClaimForm({
  onSubmitted,
  takenNames = [],
}: {
  onSubmitted: (claim: Claim) => void;
  takenNames?: string[];
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ([...name.trim()].length < 2) return toast.error('请填写圈名（至少 2 个字符）');
    if (takenNames.some((n) => n.toLowerCase() === name.trim().toLowerCase())) {
      return toast.error('该圈名已被绑定，如有异议可在圈名详情页提交申诉');
    }
    if (files.length === 0) return toast.error('请至少上传 1 张归属权证明材料');

    const form = new FormData();
    form.append('name', name.trim());
    form.append('description', description.trim());
    files.forEach((f) => form.append('images', f.file));

    setLoading(true);
    setProgress(15);
    try {
      const timer = setInterval(() => setProgress((p) => (p < 85 ? p + 7 : p)), 260);
      const data = await api.post<{ claim: Claim }>('/claims', form);
      clearInterval(timer);
      setProgress(100);
      toast.success('申请已提交', { description: '管理员会尽快审核，结果可在「我的申请」与通知中心查看' });
      setName('');
      setDescription('');
      files.forEach((f) => URL.revokeObjectURL(f.url));
      setFiles([]);
      onSubmitted(data.claim);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 700);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="claim-name">
          圈名 <span className="text-rose-300">*</span>
        </Label>
        <Input
          id="claim-name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 20))}
          placeholder="例如：疏影阑珊"
          maxLength={20}
        />
        <p className="text-[11px] text-slate-500">1-20 个字符，支持中英文、数字与常见符号。</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="claim-desc">圈名简介</Label>
        <Textarea
          id="claim-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 300))}
          placeholder="简单介绍这个圈名的含义、使用场景，或你使用它的经历…（选填，最多 300 字）"
          className="min-h-20"
        />
        <div className="text-right text-[11px] text-slate-500">{description.length}/300</div>
      </div>

      <div className="space-y-2">
        <Label>
          归属权证明材料 <span className="text-rose-300">*</span>
        </Label>
        <ImageUploader files={files} setFiles={setFiles} max={6} />
        <div className="flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[11.5px] leading-relaxed text-slate-400">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300/80" />
          <span>
            建议上传：账号主页截图（含昵称与 UID）、作品发布记录、平台实名/认证信息等。
            请自行打码手机号、身份证号等敏感信息，审核仅用于确认圈名归属。
          </span>
        </div>
      </div>

      {progress > 0 && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11.5px] text-slate-500">提交后进入人工审核队列，通常 1-2 个工作日内出结果。</p>
        <Button type="submit" size="lg" disabled={loading} className="sm:w-auto">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {loading ? '提交中…' : '提交归属审核'}
        </Button>
      </div>
    </form>
  );
}
