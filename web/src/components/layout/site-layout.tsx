import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
  X,
  Info,
  Bell,
  MessageSquare,
  Scale,
} from 'lucide-react';
import { Aurora } from '@/components/aurora';
import { PageTransition } from '@/components/page-transition';
import { BrandMark } from '@/components/logo';
import { JoinGroupButton } from '@/components/join-group-button';
import { NotificationBell } from '@/components/notification-bell';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/lib/auth';
import { cn, initials, ROLE_META } from '@/lib/utils';
import { DEVELOPER, SITE_NAME } from '@/lib/site';

const NAV = [
  { to: '/', label: '圈名广场', icon: Search, end: true },
  { to: '/court', label: '小法庭', icon: Scale },
  { to: '/feedback', label: '反馈', icon: MessageSquare },
  { to: '/about', label: '关于项目', icon: Info },
];

export default function SiteLayout() {
  const { user, logout, isStaff } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = useMemo(() => {
    const list = [...NAV];
    if (user) list.push({ to: '/me', label: '个人中心', icon: UserIcon });
    if (user) list.push({ to: '/notifications', label: '通知', icon: Bell });
    // 普通用户不显示管理后台入口
    if (isStaff) list.push({ to: '/admin', label: '管理后台', icon: LayoutDashboard });
    return list;
  }, [user, isStaff]);

  return (
    <div className="relative flex min-h-screen flex-col">
      <Aurora />

      <header className="sticky top-0 z-40">
        <div className="border-b border-white/[0.06] bg-[#07070e]/72 shadow-[0_1px_0_rgba(255,255,255,.04)] backdrop-blur-2xl backdrop-saturate-150">
          <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
            <Link to="/" className="shrink-0 transition-opacity hover:opacity-85">
              <BrandMark />
            </Link>

            <nav className="ml-4 hidden items-center gap-1 md:flex">
              {links.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={(item as any).end}
                  className={({ isActive }) =>
                    cn(
                      'relative rounded-lg px-3 py-2 text-[13px] font-medium',
                      'transition-[color,background-color] duration-200 ease-out',
                      'hover:bg-white/[0.06] active:scale-[0.97]',
                      isActive ? 'text-white' : 'text-slate-400 hover:text-slate-100',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {item.label}
                      <span
                        className={cn(
                          'pointer-events-none absolute inset-x-2 -bottom-[1px] h-px origin-center bg-gradient-to-r from-transparent via-violet-300 to-transparent',
                          'transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                          isActive ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0',
                        )}
                      />
                    </>
                  )}
                </NavLink>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <JoinGroupButton className="hidden lg:inline-flex" label="加入交流群" />

              {user && <NotificationBell />}

              {user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-1 pr-2 pl-1 transition hover:bg-white/[0.09]">
                      <Avatar className="size-8">
                        <AvatarFallback
                          className="text-xs"
                          style={{
                            background: `linear-gradient(135deg, hsl(${user.avatarHue} 70% 55%), hsl(${(user.avatarHue + 50) % 360} 75% 45%))`,
                          }}
                        >
                          {initials(user.nickname)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="hidden max-w-24 truncate text-[13px] text-slate-200 sm:block">{user.nickname}</span>
                      <ChevronDown className="size-3.5 text-slate-500" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel>
                      <div className="flex flex-col gap-1 py-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-medium text-white">{user.nickname}</span>
                          <span
                            className={cn(
                              'rounded-full border px-1.5 py-0 text-[9.5px]',
                              ROLE_META[user.role]?.tone || ROLE_META.user.tone,
                            )}
                          >
                            {ROLE_META[user.role]?.label || '普通用户'}
                          </span>
                        </div>
                        <span className="truncate text-[11px] text-slate-500">{user.email}</span>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => navigate('/me')}>
                      <UserIcon /> 个人中心
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => navigate('/notifications')}>
                      <Bell /> 通知中心
                    </DropdownMenuItem>
                    {isStaff && (
                      <DropdownMenuItem onSelect={() => navigate('/admin')}>
                        <ShieldCheck /> 管理后台
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="danger"
                      onSelect={async () => {
                        await logout();
                        navigate('/');
                      }}
                    >
                      <LogOut /> 退出登录
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <Button variant="ghost" size="sm" className="h-9 px-2.5 sm:px-3" onClick={() => navigate('/login')}>
                    登录
                  </Button>
                  <Button size="sm" className="h-9 px-3" onClick={() => navigate('/register')}>
                    <Sparkles className="size-3.5" />
                    <span>注册</span>
                  </Button>
                </div>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setMobileOpen((v) => !v)}
                aria-label="菜单"
              >
                {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
              </Button>
            </div>
          </div>

          {mobileOpen && (
            <div className="border-t border-white/[0.06] px-4 py-3 md:hidden">
              <div className="flex flex-col gap-1">
                {links.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={(item as any).end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
                        isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5',
                      )
                    }
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </NavLink>
                ))}
                <div className="mt-2">
                  <JoinGroupButton className="w-full justify-center" />
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1">
        <PageTransition>
          <Outlet />
        </PageTransition>
      </main>

      <footer className="relative mt-20 border-t border-white/[0.06] bg-[#07070e]/60 backdrop-blur-xl">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
          <div className="space-y-3">
            <BrandMark />
            <p className="max-w-sm text-[12.5px] leading-relaxed text-slate-500">
              {SITE_NAME} 是一个面向创作圈的圈名归属登记与检索平台。我们希望通过「材料审核 + 公开检索」的方式，让每一个独特的圈名都有清晰的归属。
            </p>
          </div>
          <div className="space-y-2.5">
            <h4 className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">导航</h4>
            <div className="flex flex-col gap-2 text-[13px] text-slate-400">
              <Link to="/" className="transition hover:text-white">
                圈名广场
              </Link>
              <Link to="/me" className="transition hover:text-white">
                个人中心
              </Link>
              <Link to="/notifications" className="transition hover:text-white">
                通知中心
              </Link>
              <Link to="/about" className="transition hover:text-white">
                关于项目
              </Link>
            </div>
          </div>
          <div className="space-y-2.5">
            <h4 className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">联系</h4>
            <div className="flex flex-col gap-2 text-[13px] text-slate-400">
              <span>
                开发者：<span className="text-slate-200">{DEVELOPER}</span>
              </span>
              <JoinGroupButton variant="outline" className="w-fit" label="加入交流群" />
            </div>
          </div>
        </div>
        <div className="border-t border-white/[0.05] px-4 py-5 text-center text-[11.5px] text-slate-600">
          © {new Date().getFullYear()} {SITE_NAME} · Designed &amp; Built by {DEVELOPER}
        </div>
      </footer>
    </div>
  );
}
