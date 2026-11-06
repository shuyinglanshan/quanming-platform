import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Crown, Loader2, Save, Shield, ShieldCheck, User as UserIcon, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

type RoleDef = { key: string; label: string; desc: string };
type Feature = { key: string; label: string; desc: string };
type RolesData = { roles: RoleDef[]; features: Feature[]; grants: Record<string, string[]> };

const ROLE_ICON: Record<string, any> = {
  admin: Crown,
  superadmin: ShieldCheck,
  assessor: Shield,
  user: UserIcon,
};

const ROLE_TONE: Record<string, string> = {
  admin: 'border-rose-300/30 bg-rose-400/10 text-rose-200',
  superadmin: 'border-violet-300/30 bg-violet-400/12 text-violet-200',
  assessor: 'border-sky-300/30 bg-sky-400/10 text-sky-200',
  user: 'border-white/15 bg-white/5 text-slate-300',
};

/** 基础权限（不可关闭，展示用） */
const BASE_FEATURES: Record<string, string[]> = {
  superadmin: ['dashboard'],
  assessor: ['dashboard'],
  user: [],
};

export function RolesPanel() {
  const [data, setData] = useState<RolesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({ superadmin: [], assessor: [] });
  const [saving, setSaving] = useState<string | null>(null);
  const [active, setActive] = useState<'superadmin' | 'assessor'>('superadmin');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<RolesData>('/admin/roles');
      setData(res);
      setDrafts({
        superadmin: res.grants.superadmin || [],
        assessor: res.grants.assessor || [],
      });
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (feature: string) => {
    setDrafts((d) => {
      const cur = new Set(d[active] || []);
      if (cur.has(feature)) cur.delete(feature);
      else cur.add(feature);
      return { ...d, [active]: [...cur] };
    });
  };

  const save = async () => {
    setSaving(active);
    try {
      await api.put(`/admin/roles/${active}/features`, { features: drafts[active] || [] });
      toast.success('功能权限已保存', { description: '该角色下次请求即刻生效' });
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="glass flex items-center justify-center gap-2 rounded-2xl py-16 text-[13px] text-slate-400">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
    );
  }
  if (!data) return <div className="glass rounded-2xl p-6 text-[13px] text-slate-400">加载失败</div>;

  const granted = new Set(drafts[active] || []);
  const base = new Set(BASE_FEATURES[active] || []);

  return (
    <div className="space-y-4">
      {/* 角色说明 */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {data.roles.map((r) => {
          const Icon = ROLE_ICON[r.key] || UserIcon;
          const isActive = r.key === active;
          const selectable = r.key === 'superadmin' || r.key === 'assessor';
          return (
            <button
              key={r.key}
              onClick={() => selectable && setActive(r.key as any)}
              disabled={!selectable}
              className={cn(
                'glass rounded-2xl p-4 text-left transition',
                selectable && 'hover:border-white/20',
                isActive && selectable && 'border-violet-300/40 bg-violet-400/[0.08]',
                !selectable && 'cursor-default opacity-90',
              )}
            >
              <div className="flex items-center gap-2">
                <div className={cn('grid size-8 place-items-center rounded-lg border', ROLE_TONE[r.key])}>
                  <Icon className="size-4" />
                </div>
                <span className="text-[13.5px] font-medium text-white">{r.label}</span>
                {isActive && selectable && <Badge variant="default" className="ml-auto text-[9.5px]">配置中</Badge>}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{r.desc}</p>
            </button>
          );
        })}
      </div>

      {/* 功能开关 */}
      <div className="glass rounded-2xl p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-medium text-white">
              <UserCog className="size-4 text-violet-200" />
              为「{active === 'superadmin' ? '超级管理员' : '审核员'}」配置功能权限
            </h3>
            <p className="mt-1 text-[11.5px] text-slate-500">
              开启后该角色即可使用对应管理功能；关闭后立即失去入口与接口权限。
            </p>
          </div>
          <Button onClick={save} disabled={saving === active} size="sm">
            {saving === active ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 保存配置
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {data.features.map((f) => {
            const isBase = base.has(f.key);
            const on = isBase || granted.has(f.key);
            return (
              <div
                key={f.key}
                className={cn(
                  'flex items-start gap-3 rounded-xl border px-3.5 py-3 transition',
                  on ? 'border-violet-300/25 bg-violet-400/[0.06]' : 'border-white/8 bg-white/[0.02]',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12.5px] font-medium text-white">{f.label}</span>
                    {isBase && <span className="rounded border border-white/10 bg-white/5 px-1 text-[9px] text-slate-400">基础</span>}
                  </div>
                  <p className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{f.desc}</p>
                </div>
                <Switch checked={on} disabled={isBase} onCheckedChange={() => toggle(f.key)} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
