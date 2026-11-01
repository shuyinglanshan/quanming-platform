import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

export default function RequireAuth({
  children,
  admin = false,
  staff = false,
  permission,
}: {
  children: React.ReactNode;
  /** 仅管理员 */
  admin?: boolean;
  /** 管理员或审核员 */
  staff?: boolean;
  /** 指定权限点 */
  permission?: string;
}) {
  const { user, loading, can, isStaff, isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`, { replace: true });
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-slate-400">
        <Loader2 className="size-6 animate-spin text-violet-300" />
        <p className="text-sm">正在验证登录状态…</p>
      </div>
    );
  }

  if (!user) return null;

  const allowed =
    (!admin || isAdmin) && (!staff || isStaff) && (!permission || can(permission));

  if (!allowed) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-5 text-center">
        <div className="glass grid size-16 place-items-center rounded-2xl">
          <ShieldAlert className="size-7 text-rose-300" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-white">没有访问权限</h2>
          <p className="text-sm leading-relaxed text-slate-400">
            该页面仅对平台管理员与审核员开放。如需协助审核圈名归属或申诉，请联系管理员开通权限。
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link to="/">返回首页</Link>
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
