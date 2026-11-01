import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  BadgeCheck,
  Boxes,
  Brush,
  Code2,
  Database,
  Gavel,
  Heart,
  ImagePlus,
  BellRing,
  ShieldAlert,
  Layers,
  LockKeyhole,
  Mail,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { JoinGroupButton } from '@/components/join-group-button';
import { DEVELOPER, GROUP_NUMBER, SITE_NAME } from '@/lib/site';
import { useAuth } from '@/lib/auth';

const FEATURES = [
  {
    icon: ScanSearch,
    title: '圈名检索',
    desc: '输入关键词即可在已绑定的圈名库中快速检索，支持联想补全、热度排序与归属详情页跳转。',
  },
  {
    icon: ShieldCheck,
    title: '归属权审核',
    desc: '提交主页、作品截图等材料，管理员逐条人工复核，通过后才完成绑定，杜绝冒名占名。',
  },
  {
    icon: ImagePlus,
    title: '材料留痕',
    desc: '每次申请的材料、审核时间与驳回理由都会完整记录，你随时可以查看与补充重提。',
  },
  {
    icon: BadgeCheck,
    title: '多平台绑定',
    desc: '支持绑定 QQ、微信、小红书账号，圈名详情页展示身份标识，让归属更具说服力。',
  },
  {
    icon: LockKeyhole,
    title: 'QQ 邮箱验证',
    desc: '注册与登录均需 QQ 邮箱验证码校验，邮箱后缀自动识别，避免无效账号与恶意注册。',
  },
  {
    icon: Database,
    title: '访问日志',
    desc: '后台记录每一次访问的操作、IP、设备与耗时，异常行为可追溯到具体账号。',
  },
  {
    icon: Gavel,
    title: '归属申诉',
    desc: '圈名详情页可直接发起申诉，人工复核通过后归属即时转移，双方都会收到通知。',
  },
  {
    icon: BellRing,
    title: '通知中心',
    desc: '个人通知与系统公告集中呈现，支持后台定向发送与全员广播，未读红点实时提醒。',
  },
  {
    icon: Users,
    title: '权限组管理',
    desc: '管理员 / 审核员 / 普通用户三级权限，后台按权限点展示功能，普通用户不显示入口。',
  },
  {
    icon: ShieldAlert,
    title: '访问风控',
    desc: '滑动窗口检测频繁请求，先提醒再短暂拉黑，并支持永久拉黑与解除，避免误伤。',
  },
];

const STACK = [
  { name: 'Node.js', desc: 'Express 后端服务', icon: Code2 },
  { name: 'React 19', desc: '前端框架', icon: Boxes },
  { name: 'shadcn/ui', desc: '组件体系', icon: Layers },
  { name: 'Tailwind CSS', desc: '毛玻璃视觉', icon: Brush },
  { name: 'Radix UI', desc: '无障碍交互', icon: Zap },
  { name: 'JSON Store', desc: '轻量数据持久化', icon: Database },
];

export default function AboutPage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Hero */}
      <section className="glass relative overflow-hidden rounded-3xl px-6 py-12 text-center sm:px-12 sm:py-16">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(34rem_24rem_at_50%_-10%,rgba(139,92,246,.22),transparent_70%)]" />
        <div className="relative mx-auto max-w-2xl">
          <Badge variant="secondary" className="mx-auto mb-5 gap-1.5">
            <Sparkles className="size-3 text-violet-300" /> About the Project
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-[2.6rem] sm:leading-[1.15]">
            <span className="text-gradient">关于{SITE_NAME}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-[13.5px] leading-relaxed text-slate-400 sm:text-[14.5px]">
            {SITE_NAME}是一个为创作圈打造的「圈名归属登记」平台。
            在圈子里，一个名字往往承载着长期积累的作品、口碑与身份认同，
            却总被撞名、冒用、抢注困扰。我们希望用一份可查、可追溯的归属记录，
            让每一个名字都能找到它真正的主人。
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
            <Button asChild size="lg">
              <Link to={user ? '/me?tab=claim' : '/register'}>
                <ImagePlus className="size-4" /> {user ? '提交圈名归属审核' : '注册并登记圈名'}
              </Link>
            </Button>
            <JoinGroupButton variant="outline" className="h-12 rounded-2xl px-5 text-[14px]" />
          </div>
        </div>
      </section>

      {/* 项目描述 + 开发者 */}
      <section className="mt-6 grid gap-3 lg:grid-cols-3">
        <div className="glass rounded-3xl p-6 lg:col-span-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <span className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/[0.05]">
              <Heart className="size-3.5 text-rose-300" />
            </span>
            项目描述
          </h2>
          <div className="mt-4 space-y-3.5 text-[13px] leading-[1.85] text-slate-400">
            <p>
              平台的核心是「归属」二字。用户注册后可以提交圈名归属申请，并上传能证明自己使用该圈名的材料，
              例如个人主页截图、作品发布记录、平台认证信息等。管理员在后台逐条查看材料，
              决定通过或驳回；驳回时必须填写理由，用户可在个人中心看到具体原因并补充材料重新提交。
            </p>
            <p>
              审核通过的圈名会进入「圈名广场」，对所有人公开可检索。每条记录都带有归属人、审核通过时间、
              收录时间与浏览量，并展示其绑定的 QQ / 微信 / 小红书标识，方便圈友之间互相确认身份。
            </p>
            <p>
              若你认为某个圈名的归属存在争议，可以在圈名详情页提交归属申诉并上传材料。
              申诉通过后，圈名归属会转移至申诉账号，系统会同时通知申诉人与原归属账号，
              整个过程都会留痕可查。
            </p>
            <p>
              后台按权限组划分：<span className="text-slate-200">管理员</span>拥有全部能力，
              <span className="text-slate-200">审核员</span>专注归属与申诉审核，
              <span className="text-slate-200">普通用户</span>不会看到管理入口。
              后台还提供用户与权限组管理、圈名管理、通知发布、QQ 邮箱配置、访问日志，
              以及基于 IP 的频繁请求检测与拉黑策略。
            </p>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              { k: '圈名登记', v: '公开可查' },
              { k: '审核方式', v: '人工复核' },
              { k: '材料要求', v: '截图凭证' },
              { k: '驳回反馈', v: '附明理由' },
            ].map((i) => (
              <div key={i.k} className="rounded-xl border border-white/8 bg-white/[0.035] p-3">
                <div className="text-[10.5px] text-slate-500">{i.k}</div>
                <div className="mt-1 text-[13px] font-medium text-slate-100">{i.v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass relative overflow-hidden rounded-3xl p-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_22rem_at_85%_-10%,rgba(139,92,246,.22),transparent_70%)]" />
          <div className="relative">
            <div className="text-[11px] tracking-[0.2em] text-slate-500 uppercase">Developer</div>
            <div className="mt-3 flex items-center gap-3">
              <div className="grid size-14 place-items-center rounded-2xl border border-white/15 bg-gradient-to-br from-violet-500/70 to-cyan-400/50 text-lg font-semibold text-white shadow-[0_16px_36px_-18px_rgba(139,92,246,1)]">
                疏
              </div>
              <div>
                <div className="text-lg font-semibold tracking-tight text-white">{DEVELOPER}</div>
                <div className="mt-0.5 text-[11.5px] text-slate-400">独立开发者 · 设计与实现</div>
              </div>
            </div>
            <p className="mt-4 text-[12.5px] leading-relaxed text-slate-400">
              喜欢写字、画画，也喜欢做一些小而美的工具。这个平台最初只是想给朋友们一个
              「查名字有没有被占用」的地方，后来慢慢长成了现在的样子。
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Badge variant="secondary">全栈开发</Badge>
              <Badge variant="secondary">UI 设计</Badge>
              <Badge variant="secondary">运维部署</Badge>
            </div>
            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2 text-[12px]">
                <span className="flex items-center gap-2 text-slate-400">
                  <Mail className="size-3.5" /> 交流群号
                </span>
                <span className="font-mono text-slate-200">{GROUP_NUMBER}</span>
              </div>
              <JoinGroupButton className="w-full justify-center" label="点击加入 QQ 交流群" />
            </div>
          </div>
        </div>
      </section>

      {/* 功能 */}
      <section className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
          <span className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/[0.05]">
            <Layers className="size-3.5 text-cyan-300" />
          </span>
          平台能力
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="glass animate-rise group rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:border-white/20"
              style={{ animationDelay: `${i * 45}ms` }}
            >
              <div className="grid size-10 place-items-center rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/25 to-cyan-400/12 transition-transform group-hover:scale-105">
                <f.icon className="size-4 text-violet-200" />
              </div>
              <h3 className="mt-3.5 text-[14.5px] font-medium text-white">{f.title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 技术栈 + 加入 */}
      <section className="mt-6 grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <div className="glass rounded-3xl p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <span className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/[0.05]">
              <Code2 className="size-3.5 text-violet-300" />
            </span>
            技术栈
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {STACK.map((s) => (
              <div key={s.name} className="rounded-xl border border-white/8 bg-white/[0.035] p-3 transition hover:border-white/16">
                <s.icon className="size-4 text-slate-400" />
                <div className="mt-2 text-[12.5px] font-medium text-slate-100">{s.name}</div>
                <div className="text-[10.5px] text-slate-500">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-3xl p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <span className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/[0.05]">
              <Users className="size-3.5 text-emerald-300" />
            </span>
            加入我们
          </h2>
          <p className="mt-3 text-[12.5px] leading-relaxed text-slate-400">
            无论你是想登记圈名、反馈 bug，还是对审核结果有疑问，
            都欢迎加入 QQ 交流群。群里有开发者和其他圈友，会尽快回复你。
          </p>
          <div className="mt-4 space-y-2">
            <JoinGroupButton className="w-full justify-center" label="加入交流群" />
            <Button asChild variant="secondary" className="w-full">
              <Link to={user ? '/me' : '/login'}>
                前往个人中心 <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-500">
            提示：交流群链接为 QQ 官方群邀请链接，若在微信内打开请复制到浏览器或 QQ 中访问。
          </div>
        </div>
      </section>

      <p className="mt-10 text-center text-[11.5px] text-slate-600">
        {SITE_NAME} · 由 {DEVELOPER} 设计与开发 · 感谢每一位认真使用它的圈友
      </p>
    </div>
  );
}
