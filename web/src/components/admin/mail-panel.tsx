import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Eye,
  Info,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Send,
  Server,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  passSet: boolean;
  passMasked: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  template: string;
  configured: boolean;
  source: 'admin' | 'env' | 'none';
};

type MailData = {
  config: MailConfig;
  defaultTemplate: string;
  variables: { key: string; desc: string }[];
  smtpHint: string;
};

export function MailPanel() {
  const [data, setData] = useState<MailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [form, setForm] = useState({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    user: '',
    pass: '',
    fromName: '小天才圈名平台',
    fromEmail: '',
    subject: '',
    template: '',
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<MailData>('/admin/mail');
      setData(res);
      setForm({
        host: res.config.host,
        port: res.config.port,
        secure: res.config.secure,
        user: res.config.user,
        pass: '',
        fromName: res.config.fromName,
        fromEmail: res.config.fromEmail,
        subject: res.config.subject,
        template: res.config.template,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/admin/mail', { ...form, fromEmail: form.fromEmail || form.user });
      toast.success('邮箱配置已保存', { description: form.user ? '注册与登录验证码将使用该邮箱发送' : '请填写完整账号与授权码后才会真实发送' });
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    setVerifying(true);
    try {
      const res = await api.post<{ ok: boolean; error?: string; user?: string }>('/admin/mail/verify');
      if (res.ok) toast.success('SMTP 连接正常，可以正常发送验证码', { description: res.user });
      else toast.error('SMTP 连接不可用', { description: res.error });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '校验失败');
    } finally {
      setVerifying(false);
    }
  };

  const openPreview = async () => {
    try {
      const res = await api.get<{ subject: string; html: string }>('/admin/mail/preview');
      setPreview(res);
      setPreviewOpen(true);
    } catch {
      toast.error('预览生成失败');
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await api.post<{ message: string }>('/admin/mail/test', { to: testTo });
      toast.success('测试邮件已发送', { description: res.message });
      setTestOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '发送失败');
    } finally {
      setTesting(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  const configured = data.config.configured;

  return (
    <div className="space-y-3">
      {/* 状态卡 */}
      <div className="glass rounded-2xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={cn('grid size-10 place-items-center rounded-xl border', configured ? 'border-emerald-300/25 bg-emerald-400/10' : 'border-amber-300/25 bg-amber-400/10')}>
              {configured ? <CheckCircle2 className="size-4 text-emerald-300" /> : <TriangleAlert className="size-4 text-amber-300" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[14px] font-medium text-white">QQ 邮箱发信配置</h3>
                <Badge variant={configured ? 'success' : 'warning'}>{configured ? '发信已启用' : '尚未配置'}</Badge>
                <Badge variant="secondary">
                  {data.config.source === 'admin' ? '来源：后台配置' : data.config.source === 'env' ? '来源：环境变量' : '来源：未配置'}
                </Badge>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{data.smtpHint}</p>
              {configured && (
                <p className="mt-1 text-[11.5px] text-slate-500">
                  发件账号：<span className="text-slate-300">{data.config.user}</span>
                  {data.config.passSet && <span className="ml-2 text-slate-600">授权码 {data.config.passMasked}</span>}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={verify} disabled={verifying}>
              {verifying ? <Loader2 className="size-3.5 animate-spin" /> : <Server className="size-3.5" />} 测试连接
            </Button>
            <Button variant="secondary" size="sm" onClick={openPreview}>
              <Eye className="size-3.5" /> 预览邮件
            </Button>
            <Button size="sm" onClick={() => { setTestTo(data.config.user || ''); setTestOpen(true); }} disabled={!configured}>
              <Send className="size-3.5" /> 发送测试邮件
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.15fr]">
        {/* 账号配置 */}
        <div className="glass space-y-4 rounded-2xl p-5">
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-violet-200" />
            <h3 className="text-[13.5px] font-medium text-white">账号与服务器</h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="mail-user">QQ 邮箱账号</Label>
              <Input
                id="mail-user"
                value={form.user}
                onChange={(e) => setForm({ ...form, user: e.target.value.trim() })}
                placeholder="例如 123456789@qq.com"
                autoComplete="off"
              />
              <p className="text-[10.5px] text-slate-500">仅支持 @qq.com</p>
            </div>

            <div className="col-span-2 space-y-2">
              <Label htmlFor="mail-pass">SMTP 授权码</Label>
              <Input
                id="mail-pass"
                type="password"
                value={form.pass}
                onChange={(e) => setForm({ ...form, pass: e.target.value })}
                placeholder={data.config.passSet ? `已设置（${data.config.passMasked}），留空表示不修改` : '请输入 QQ 邮箱 SMTP 授权码'}
                autoComplete="new-password"
              />
              <p className="text-[10.5px] leading-relaxed text-slate-500">
                QQ 邮箱需在「设置 → 账户 → POP3/IMAP/SMTP 服务」开启并生成授权码，<span className="text-amber-300/90">不是登录密码</span>。
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mail-from">发送者名称</Label>
              <Input
                id="mail-from"
                value={form.fromName}
                onChange={(e) => setForm({ ...form, fromName: e.target.value.slice(0, 40) })}
                placeholder="小天才圈名平台"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mail-from-email">发件地址（选填）</Label>
              <Input
                id="mail-from-email"
                value={form.fromEmail}
                onChange={(e) => setForm({ ...form, fromEmail: e.target.value.trim() })}
                placeholder="默认与账号一致"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mail-host">SMTP 服务器</Label>
              <Input id="mail-host" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value.trim() })} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mail-port">端口</Label>
              <Input
                id="mail-port"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value.replace(/\D/g, '')) || 465 })}
              />
            </div>

            <div className="col-span-2 flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <div>
                <div className="text-[12.5px] text-slate-200">SSL 加密连接</div>
                <div className="text-[10.5px] text-slate-500">QQ 邮箱 465 端口需开启；587 端口通常关闭</div>
              </div>
              <Switch checked={form.secure} onCheckedChange={(v) => setForm({ ...form, secure: v })} />
            </div>
          </div>

          <Button className="w-full" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} 保存配置
          </Button>
        </div>

        {/* 模板配置 */}
        <div className="glass space-y-3 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-cyan-200" />
              <h3 className="text-[13.5px] font-medium text-white">验证码邮件模板</h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setForm({ ...form, template: data.defaultTemplate })}
              className="h-7 text-[11px]"
            >
              <RefreshCw className="size-3" /> 恢复默认
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mail-subject">邮件主题</Label>
            <Input
              id="mail-subject"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="【小天才圈名平台】{{action}}验证码 {{code}}"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mail-template">邮件正文（HTML）</Label>
            <Textarea
              id="mail-template"
              value={form.template}
              onChange={(e) => setForm({ ...form, template: e.target.value })}
              className="min-h-[15rem] font-mono text-[11px] leading-relaxed"
              spellCheck={false}
            />
          </div>

          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
              <Info className="size-3" /> 可用变量
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.variables.map((v) => (
                <button
                  key={v.key}
                  onClick={() => {
                    navigator.clipboard?.writeText(v.key);
                    toast.success(`已复制 ${v.key}`);
                  }}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10.5px] text-violet-200 transition hover:border-violet-300/30"
                  title={v.desc}
                >
                  {v.key}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-amber-300/15 bg-amber-400/[0.06] p-3 text-[11px] leading-relaxed text-amber-200/85">
            模板必须包含 <code className="rounded bg-black/30 px-1">{'{{code}}'}</code> 变量，否则保存会被拒绝。
            修改模板后需点击左侧「保存配置」生效，注册与登录验证码都会使用该模板。
          </div>
        </div>
      </div>

      {/* 预览 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>邮件预览</DialogTitle>
            <DialogDescription>主题：{preview?.subject}</DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#07070d]">
            <iframe title="邮件预览" srcDoc={preview?.html || ''} className="h-[26rem] w-full" />
          </div>
        </DialogContent>
      </Dialog>

      {/* 测试邮件 */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>发送测试邮件</DialogTitle>
            <DialogDescription>将使用当前保存的配置发送一封测试邮件，请先保存配置。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="test-to">收件邮箱</Label>
            <Input id="test-to" value={testTo} onChange={(e) => setTestTo(e.target.value.trim())} placeholder="123456789@qq.com" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTestOpen(false)}>取消</Button>
            <Button onClick={sendTest} disabled={testing || !testTo}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} 发送
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
