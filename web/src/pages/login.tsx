import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AtSign, CircleAlert, Eye, EyeOff, KeyRound, Loader2, LogIn, MailCheck, ShieldCheck, Smartphone, User as UserIcon,
  Inbox,
} from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { EmailField } from '@/components/email-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError, type User } from '@/lib/api';
import { sha256Hex } from '@/lib/password';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Mode = 'password' | 'code';

function detectKind(value: string): { icon: any; hint: string } {
  const v = value.trim();
  if (!v) return { icon: UserIcon, hint: '邮箱 / 手机号 / 用户名 均可登录' };
  if (v.includes('@')) return { icon: AtSign, hint: '使用邮箱登录' };
  if (/^1\d{10}$/.test(v)) return { icon: Smartphone, hint: '使用手机号登录' };
  if (/^1\d+$/.test(v)) return { icon: Smartphone, hint: '手机号需为 11 位数字' };
  return { icon: UserIcon, hint: '使用用户名登录' };
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/';
  const { setUser, user, mailConfigured } = useAuth();

  const [mode, setMode] = useState<Mode>('password');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [emailValid, setEmailValid] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentOnce, setSentOnce] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (user) navigate(redirect, { replace: true });
  }, [user, navigate, redirect]);

  useEffect(() => {
    if (countdown <= 0) return;
    timerRef.current = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [countdown]);

  const finish = (u: User) => {
    setUser(u);
    toast.success(`欢迎回来，${u.nickname}`, {
      description: u.role === 'admin' ? '管理员身份已确认，可进入管理后台' : '祝你找到心仪的圈名',
    });
    navigate(redirect, { replace: true });
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return toast.error('请输入邮箱、手机号或用户名');
    if (!password) return toast.error('请输入密码');
    setLoading(true);
    try {
      // 密码先做 SHA-256 变换，避免明文经过网络（服务端仍会 bcrypt 加盐存储）
      const hashed = await sha256Hex(password);
      const data = await api.post<{ user: User }>('/auth/login', {
        identifier: identifier.trim(),
        password: hashed,
        pwdAlg: 'sha256',
      });
      finish(data.user);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailValid) return toast.error('请输入正确的邮箱地址');
    if (!/^\d{6}$/.test(code)) return toast.error('请输入 6 位验证码');
    setLoading(true);
    try {
      const data = await api.post<{ user: User }>('/auth/login-code', { email: email.trim(), code });
      finish(data.user);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const sendCode = async () => {
    if (!emailValid) return toast.error('请输入正确的邮箱地址');
    setSending(true);
    try {
      await api.post('/auth/send-code', { email: email.trim(), purpose: 'login' });
      setCountdown(60);
      setSentOnce(true);
      toast.success('验证码已发送', { description: '请查看你的邮箱（含垃圾箱），10 分钟内有效' });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '验证码发送失败');
    } finally {
      setSending(false);
    }
  };

  const kind = detectKind(identifier);
  const KindIcon = kind.icon;

  return (
    <AuthShell
      title="登录小天才圈名平台"
      subtitle="邮箱、手机号或用户名均可登录，继续管理你的圈名与归属申请。"
      footer={
        <>
          还没有账号？
          <Link to={`/register?redirect=${encodeURIComponent(redirect)}`} className="ml-1 font-medium text-violet-300 hover:text-violet-200">
            立即注册
          </Link>
        </>
      }
    >
      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <TabsList className="mb-5 w-full">
          <TabsTrigger value="password" className="flex-1">
            <KeyRound className="size-3.5" /> 密码登录
          </TabsTrigger>
          <TabsTrigger value="code" className="flex-1">
            <MailCheck className="size-3.5" /> 验证码登录
          </TabsTrigger>
        </TabsList>

        <TabsContent value="password">
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">账号</Label>
              <div className="relative">
                <KindIcon className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="identifier"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="邮箱 / 手机号 / 用户名"
                  autoComplete="username"
                  className="pl-10"
                />
              </div>
              <p className="text-[11px] text-slate-500">{kind.hint}</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">密码</Label>
                <span className="text-[11px] text-slate-500">忘记密码请加入交流群找回</span>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入登录密码"
                  autoComplete="current-password"
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
                >
                  {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              {loading ? '登录中…' : '登录'}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="code">
          <form onSubmit={handleCodeLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-code">邮箱地址</Label>
              <EmailField
                id="email-code"
                value={email}
                onChange={setEmail}
                onValidChange={(info) => setEmailValid(info.valid)}
                statusMode="login"
                placeholder="请输入邮箱地址"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">邮箱验证码</Label>
              <div className="flex gap-2">
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6 位数字验证码"
                  inputMode="numeric"
                  className="tracking-[0.4em]"
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 w-32 shrink-0"
                  disabled={sending || countdown > 0 || !emailValid}
                  onClick={sendCode}
                >
                  {sending ? <Loader2 className="size-3.5 animate-spin" /> : <MailCheck className="size-3.5" />}
                  {countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
                </Button>
              </div>
              {/* 发送成功后常驻提示：邮件可能进垃圾箱 */}
              {sentOnce && (
                <div className="flex items-start gap-1.5 rounded-lg border border-sky-300/20 bg-sky-400/[0.07] px-2.5 py-2 text-[11px] leading-relaxed text-sky-200/90">
                  <Inbox className="mt-0.5 size-3 shrink-0" />
                  <span>
                    验证码已发送，请到邮箱查收。<span className="font-medium text-sky-100">如果没收到邮件，请查看垃圾邮件 / 广告邮件文件夹</span>。
                  </span>
                </div>
              )}
            </div>

            {mailConfigured === false && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-400/[0.08] p-3 text-[11.5px] leading-relaxed text-amber-200/90">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                平台尚未完成邮箱发信配置，验证码登录暂不可用。可改用密码登录，或联系管理员完成配置。
              </div>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              {loading ? '验证中…' : '验证码登录'}
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      <div className={cn('mt-5 flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[11.5px] leading-relaxed text-slate-400')}>
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
        <span>
          支持邮箱、手机号、用户名三种方式登录；邮箱验证码 10 分钟内有效。
          若长时间未收到验证码，请检查垃圾邮件箱或加入交流群联系管理员。
        </span>
      </div>
    </AuthShell>
  );
}
