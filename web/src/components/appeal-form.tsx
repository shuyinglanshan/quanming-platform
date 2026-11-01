import { useState } from 'react';
import { toast } from 'sonner';
import { CircleAlert, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ImageUploader, type LocalFile } from '@/components/image-uploader';
import { api, ApiError, type Appeal } from '@/lib/api';

const REASONS = [
  '该圈名实际由我使用，原归属材料不实',
  '原归属账号冒用/盗用我的圈名',
  '圈名归属账号已转让给我',
  '原归属账号长期不活跃，本人持续使用',
  '其他情况（请在补充说明中详述）',
];

export function AppealForm({
  nameId,
  name,
  onSubmitted,
}: {
  nameId: string;
  name: string;
  onSubmitted: (appeal: Appeal) => void;
}) {
  const [reason, setReason] = useState(REASONS[0]);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return toast.error('请选择申诉类型');
    if (!files.length) return toast.error('请至少上传 1 张申诉证明材料');
    if (description.trim().length < 10) return toast.error('请补充至少 10 个字的申诉说明');

    const form = new FormData();
    form.append('nameId', nameId);
    form.append('reason', reason);
    form.append('description', description.trim());
    files.forEach((f) => form.append('images', f.file));

    setLoading(true);
    try {
      const data = await api.post<{ appeal: Appeal }>('/appeals', form);
      toast.success('申诉已提交', { description: '管理员或审核员会尽快复核，结果将通过通知告知你' });
      setFiles([]);
      setDescription('');
      onSubmitted(data.appeal);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[12px] leading-relaxed text-slate-400">
        你正在对圈名 <span className="font-medium text-white">「{name}」</span> 的归属发起申诉。
        申诉审核期间圈名归属保持不变；申诉通过后，归属将转移至你的账号，并通知原归属账号。
      </div>

      <div className="space-y-2">
        <Label>申诉类型</Label>
        <div className="grid gap-1.5">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12.5px] transition ${
                reason === r
                  ? 'border-violet-300/45 bg-violet-400/12 text-violet-100'
                  : 'border-white/8 bg-white/[0.03] text-slate-400 hover:border-white/16 hover:text-slate-200'
              }`}
            >
              <span
                className={`grid size-3.5 shrink-0 place-items-center rounded-full border ${
                  reason === r ? 'border-violet-300' : 'border-white/25'
                }`}
              >
                {reason === r && <span className="size-1.5 rounded-full bg-violet-300" />}
              </span>
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="appeal-desc">
          补充说明 <span className="text-rose-300">*</span>
        </Label>
        <Textarea
          id="appeal-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          placeholder="请说明你使用该圈名的时间、平台、作品链接等，越具体越有助于审核…"
          className="min-h-24"
        />
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">至少 10 个字，最多 500 字</span>
          <span className="text-slate-500">{description.length}/500</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label>
          申诉证明材料 <span className="text-rose-300">*</span>
        </Label>
        <ImageUploader
          files={files}
          setFiles={setFiles}
          label="上传能证明你在先使用该圈名的截图"
          hint="建议：账号主页、发布记录、时间线截图"
        />
        <div className="flex items-start gap-2 rounded-xl border border-amber-300/15 bg-amber-400/[0.06] p-3 text-[11.5px] leading-relaxed text-amber-200/90">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>请对手机号、身份证等敏感信息打码。恶意申诉将被记录，多次违规可能限制账号功能。</span>
        </div>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        {loading ? '提交中…' : '提交申诉'}
      </Button>
    </form>
  );
}
