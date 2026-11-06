import { Link } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, ShieldCheck, Sparkles } from 'lucide-react';
import { Aurora } from '@/components/aurora';
import { BrandMark } from '@/components/logo';
import { JoinGroupButton } from '@/components/join-group-button';
import { DEVELOPER } from '@/lib/site';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <Aurora />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Link to="/" className="transition-opacity hover:opacity-80">
          <BrandMark />
        </Link>
        <Link
          to="/"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-400 transition hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft className="size-3.5" /> 返回首页
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-6">
        <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          {/* 左侧品牌介绍（大屏显示） */}
          <div className="hidden flex-col gap-7 lg:flex">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11.5px] text-slate-300 backdrop-blur">
                <Sparkles className="size-3 text-violet-300" />
                QQ 邮箱一键注册 · 材料人工审核
              </div>
              <h1 className="text-[2.6rem] leading-[1.15] font-semibold tracking-tight text-balance">
                <span className="text-gradient">圈名有主，</span>
                <br />
                <span className="text-gradient">从此不再撞名。</span>
              </h1>
              <p className="mt-4 max-w-md text-[13.5px] leading-relaxed text-slate-400">
                使用 QQ 邮箱注册，提交归属权证明材料，审核通过后你的圈名将出现在圈名广场，
                并可与 QQ、微信、小红书账号绑定展示。
              </p>
            </div>

            <div className="space-y-3">
              {[
                { icon: ShieldCheck, title: '材料人工复核', desc: '上传主页 / 作品截图，管理员逐条审核并给出结论与理由。' },
                { icon: BadgeCheck, title: '归属公开可查', desc: '已绑定圈名全部公开可检索，避免重复登记与冒用。' },
              ].map((f) => (
                <div key={f.title} className="glass-soft flex items-start gap-3 rounded-2xl p-4">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/25 to-cyan-400/15">
                    <f.icon className="size-4 text-violet-200" />
                  </div>
                  <div>
                    <div className="text-[13.5px] font-medium text-white">{f.title}</div>
                    <div className="mt-1 text-[12px] leading-relaxed text-slate-400">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 text-[11.5px] text-slate-500">
              <span>开发者 {DEVELOPER}</span>
              <span className="size-1 rounded-full bg-slate-700" />
              <JoinGroupButton variant="ghost" label="加入交流群" />
            </div>
          </div>

          {/* 右侧表单 */}
          <div className="liquid liquid-sheen anim-scale-in relative w-full overflow-hidden rounded-3xl p-6 shadow-[0_24px_60px_-32px_rgba(0,0,0,.9)] sm:p-8">
            <div className="relative">
              <div className="mb-6 space-y-1.5">
                <h2 className="text-[22px] font-semibold tracking-tight text-white">{title}</h2>
                <p className="text-[13px] leading-relaxed text-slate-400">{subtitle}</p>
              </div>
              {children}
              {footer && <div className="mt-6 border-t border-white/[0.07] pt-5 text-center text-[12.5px] text-slate-400">{footer}</div>}
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 px-5 py-5 text-center text-[11px] text-slate-600">
        © {new Date().getFullYear()} 小天才圈名平台 · 保留所有权利
      </footer>
    </div>
  );
}
