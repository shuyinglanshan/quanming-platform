import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, CircleAlert, Eye, EyeOff, Loader2, MailCheck, Smartphone, UserPlus,
  Inbox,
} from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { EmailField } from '@/components/email-field';
import { SliderCaptcha, type CaptchaState } from '@/components/slider-captcha';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError, type User } from '@/lib/api';
import { sha256Hex } from '@/lib/password';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

function strengthOf(pwd: string) {
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 1;
  if (/\d/.test(pwd)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pwd)) score += 1;
  return score;
}

const PHONE_RE = /^1[3-9]\d{9}$/;
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,19}$/;

export default function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/me?tab=claim';
  const { setUser, user, mailConfigured } = useAuth();

  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [emailValid, setEmailValid] = useState(false);
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [agree, setAgree] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentOnce, setSentOnce] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [captcha, setCaptcha] = useState<CaptchaState>({ id: null, verified: false });
  const [captchaKey, setCaptchaKey] = useState(0);
  const [checking, setChecking] = useState<{ username?: string; phone?: string }>({});
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

  const onCaptcha = useCallback((state: CaptchaState) => setCaptcha(state), []);

  /* 用户名 / 手机号 实时可用性检查 */
  useEffect(() => {
    const u = username.trim();
    const p = phone.trim();
    if (!u && !p) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams();
        if (u.length >= 4) query.set('username', u);
        if (p.length === 11) query.set('phone', p);
        if (![...query.keys()].length) return;
        const res = await api.get<{
          username?: { taken: boolean; valid: boolean; error: string };
          phone?: { taken: boolean; valid: boolean; error: string };
        }>(`/auth/availability?${query}`);
        if (cancelled) return;
        setChecking({
          username: res.username
            ? res.username.taken
              ? '该用户名已被使用'
              : res.username.valid
                ? '用户名可用'
                : res.username.error
            : undefined,
          phone: res.phone
            ? res.phone.taken
              ? '该手机号已注册'
              : res.phone.valid
                ? '手机号可用'
                : res.phone.error
            : undefined,
        });
      } catch {
        /* ignore */
      }
    }, 420);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username, phone]);

  const strength = useMemo(() => strengthOf(password), [password]);
  const pwdOk = password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password);
  const pwdMatch = confirm.length > 0 && password === confirm;
  const nickOk = [...nickname.trim()].length >= 2 && [...nickname.trim()].length <= 16;
  const usernameOk = USERNAME_RE.test(username.trim());
  const phoneOk = PHONE_RE.test(phone.trim());

  const sendCode = async () => {
    // 只在邮箱注册模式下校验邮箱，避免切到手机号后仍误报
    if (method !== 'email') return;
    if (!emailValid) return toast.error('请输入正确的邮箱地址');
    setSending(true);
    try {
      await api.post('/auth/send-code', { email: email.trim(), purpose: 'register' });
      setCountdown(60);
      setSentOnce(true);
      toast.success('验证码已发送至邮箱', { description: '10 分钟内有效，请注意查收（含垃圾箱）' });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '验证码发送失败');
    } finally {
      setSending(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameOk) return toast.error('用户名需 4-20 位，以字母开头，仅含字母、数字与下划线');
    if (!nickOk) return toast.error('昵称需要 2-16 个字符');
    if (method === 'email' && !emailValid) return toast.error('请输入正确的邮箱地址');
    if (method === 'phone' && !phoneOk) return toast.error('请输入有效的手机号');
    if (!pwdOk) return toast.error('密码至少 8 位，且需包含字母与数字');
    if (!pwdMatch) return toast.error('两次输入的密码不一致');
    if (method === 'email' && !/^\d{6}$/.test(code)) return toast.error('请输入 6 位邮箱验证码');
    if (!captcha.verified) return toast.error('请先完成滑块验证');
    if (!agree) return toast.error('请先同意用户协议与隐私政策');

    setLoading(true);
    try {
      // 密码 SHA-256 变换后再提交；强度已在本地校验
      const hashedPassword = await sha256Hex(password);
      const payload: Record<string, unknown> = {
        method,
        username: username.trim(),
        nickname: nickname.trim(),
        password: hashedPassword,
        pwdAlg: 'sha256',
        captchaId: captcha.id,
        captchaCompleted: captcha.verified,
      };
      if (method === 'email') {
        payload.email = email.trim();
        payload.code = code;
      } else {
        payload.phone = phone.trim();
      }
      const data = await api.post<{ user: User }>('/auth/register', payload);
      setUser(data.user);
      toast.success('注册成功，欢迎加入', { description: '现在可以提交你的第一个圈名归属申请了' });
      navigate(redirect, { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '注册失败，请稍后重试');
      // 滑块一次性，失败后必须重新验证
      setCaptcha({ id: null, verified: false });
      setCaptchaKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="创建你的账号"
      subtitle="支持邮箱或手机号注册，注册后即可登记属于你的圈名。"
      footer={
        <>
          已经有账号了？
          <Link to={`/login?redirect=${encodeURIComponent(redirect)}`} className="ml-1 font-medium text-violet-300 hover:text-violet-200">
            去登录
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Tabs value={method} onValueChange={(v) => setMethod(v as 'email' | 'phone')}>
          <TabsList className="mb-4 w-full">
            <TabsTrigger value="email" className="flex-1">
              <MailCheck className="size-3.5" /> 邮箱注册
            </TabsTrigger>
            <TabsTrigger value="phone" className="flex-1">
              <Smartphone className="size-3.5" /> 手机号注册
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {method === 'email' ? (
          <div className="space-y-2">
            <Label htmlFor="reg-email">邮箱地址</Label>
            <EmailField
              id="reg-email"
              value={email}
              onChange={setEmail}
              onValidChange={(info) => setEmailValid(info.valid)}
              statusMode="register"
              placeholder="请输入邮箱地址，例如 name@example.com"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="reg-phone">手机号</Label>
            <div className="relative">
              <Smartphone className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-500" />
              <Input
                id="reg-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="请输入 11 位手机号"
                inputMode="numeric"
                autoComplete="tel"
                className={cn('pl-10', phone && !phoneOk && 'border-rose-400/40')}
              />
            </div>
            {checking.phone && (
              <p className={cn('flex items-center gap-1 text-[11.5px]', checking.phone.endsWith('可用') ? 'text-emerald-300' : 'text-rose-300')}>
                {checking.phone.endsWith('可用') ? <Check className="size-3" /> : <CircleAlert className="size-3" />}
                {checking.phone}
              </p>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="reg-username">
              用户名 <span className="text-rose-300">*</span>
            </Label>
            <Input
              id="reg-username"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/\s/g, '').slice(0, 20))}
              placeholder="登录用，如 lanshan01"
              autoComplete="username"
              className={cn(username && !usernameOk && 'border-rose-400/40')}
            />
            <p className={cn('text-[11px]', checking.username?.endsWith('可用') ? 'text-emerald-300' : checking.username ? 'text-rose-300' : 'text-slate-500')}>
              {checking.username || '4-20 位，字母开头，可用于登录'}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reg-nickname">昵称</Label>
            <Input
              id="reg-nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value.slice(0, 16))}
              placeholder="圈内昵称，2-16 字"
              className={cn(nickname && !nickOk && 'border-rose-400/40')}
            />
            <p className="text-[11px] text-slate-500">展示在圈名详情页，可后续修改</p>
          </div>
        </div>

        {method === 'email' && (
          <div className="space-y-2">
            <Label htmlFor="reg-code">邮箱验证码</Label>
            <div className="flex gap-2">
              <Input
                id="reg-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6 位数字"
                inputMode="numeric"
                className="tracking-[0.3em]"
              />
              <Button
                type="button"
                variant="secondary"
                className="h-11 w-[6.6rem] shrink-0 px-2 text-[12px]"
                disabled={sending || countdown > 0 || !emailValid}
                onClick={sendCode}
              >
                {sending ? <Loader2 className="size-3.5 animate-spin" /> : <MailCheck className="size-3.5" />}
                {countdown > 0 ? `${countdown}s` : '发送'}
              </Button>
            </div>
            {/* 发送成功后常驻提示：邮件可能进垃圾箱 */}
            {sentOnce && (
              <div className="flex items-start gap-1.5 rounded-lg border border-sky-300/20 bg-sky-400/[0.07] px-2.5 py-2 text-[11px] leading-relaxed text-sky-200/90">
                <Inbox className="mt-0.5 size-3 shrink-0" />
                <span>
                  验证码已发送，请到邮箱查收。<span className="font-medium text-sky-100">如果没收到邮件，请查看垃圾邮件 / 广告邮件文件夹</span>，
                  或将发件人加入白名单后重新发送。
                </span>
              </div>
            )}
          </div>
        )}

        {method === 'email' && mailConfigured === false && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-400/[0.08] p-3 text-[11.5px] leading-relaxed text-amber-200/90">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            平台尚未完成邮箱发信配置，暂时无法发送邮箱验证码。可改用手机号注册，或联系管理员完成邮箱配置。
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="reg-password">设置密码</Label>
          <div className="relative">
            <Input
              id="reg-password"
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位，需包含字母与数字"
              autoComplete="new-password"
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
          {password && (
            <div className="space-y-1.5 pt-0.5">
              <Progress value={strength * 25} className="h-1" />
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500">
                  {['太弱', '较弱', '一般', '较强', '很强'][strength]} · 建议混合大小写与符号
                </span>
                <span className={pwdOk ? 'text-emerald-300' : 'text-slate-500'}>
                  {pwdOk ? <Check className="inline size-3" /> : null} 8 位以上且含字母数字
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="reg-confirm">确认密码</Label>
          <Input
            id="reg-confirm"
            type={showPwd ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="再次输入密码"
            autoComplete="new-password"
            className={cn(confirm && !pwdMatch && 'border-rose-400/40')}
          />
        </div>

        <div className="space-y-2">
          <Label>安全验证</Label>
          <SliderCaptcha onChange={onCaptcha} resetKey={captchaKey} disabled={loading} />
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-[11.5px] leading-relaxed text-slate-400 select-none">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 rounded border-white/25 bg-white/10 accent-violet-500"
          />
          <span>
            我已阅读并同意《用户协议》与《隐私政策》，承诺提交的归属权证明材料真实有效，不侵犯他人权益。
          </span>
        </label>

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {loading ? '创建中…' : '注册并开始登记圈名'}
        </Button>
      </form>
    </AuthShell>
  );
}
