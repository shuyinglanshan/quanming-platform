import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Database, Download, FolderArchive, HardDrive, Loader2, ShieldAlert, Users, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

type ExportInfo = {
  database: { size: number; path: string };
  uploads: { count: number; size: number };
  counts: { users: number; names: number; claims: number; appeals: number };
};

function formatBytes(n: number) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 数据导出面板
 *
 * 两项导出都需要输入当前账号密码二次确认：
 *   - 数据库导出：含全部用户、圈名、申请、申诉等，属于最高敏感数据
 *   - 图片导出：全部上传材料打包为 ZIP
 *
 * 下载走浏览器原生方式（blob + a[download]），避免暴露临时文件路径。
 */

/**
 * 构造加密请求体
 *
 * 复用 lib/crypto 的会话密钥机制，生成后端可解的信封。
 * 这样导出这类「需要下载二进制」的接口也能满足
 * 服务端的强制加密要求。
 */
async function buildEncryptedBody(path: string, payload: Record<string, unknown>): Promise<string> {
  const mod = await import('@/lib/crypto');
  // secureFetch 内部会处理加密；这里借用它导出的加密能力
  const body = await mod.encryptForRequest(`/api${path}`, payload, 'POST');
  return JSON.stringify(body);
}

export function ExportPanel() {
  const [info, setInfo] = useState<ExportInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'' | 'db' | 'uploads'>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ExportInfo>('/admin/export/info');
      setInfo(res);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 触发文件下载 */
  const download = async (kind: 'db' | 'uploads') => {
    if (!password.trim()) {
      toast.error('请输入当前账号密码');
      return;
    }
    setBusy(kind);
    try {
      const path = kind === 'db' ? '/admin/export/database' : '/admin/export/uploads';

      /**
       * 关键：必须走加密通道
       *
       * 旧实现用裸 fetch 发送明文 JSON，而服务端强制所有写方法加密，
       * 因此导出请求会被拒绝（400 ENCRYPTION_REQUIRED）。
       *
       * 这里改用 secureFetch：
       *   · 自动生成一次性 AES 密钥并用 RSA 加密
       *   · 请求体加密为 { enc: {...} }
       *   · 响应若为密文会自动解密
       *
       * 由于导出返回的是二进制文件（blob），secureFetch 只能拿到
       * JSON 错误体，所以这里拆成两步：
       *   1) 先用 secureFetch 做「权限预检」（/export/info 已通过则不重复）
       *   2) 再带加密信封发起下载请求
       */
      const { secureFetch } = await import('@/lib/crypto');

      // 先生成加密信封（与后端 decryptRequest 约定一致）
      const res = await fetch(`/api${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Encrypted': '1',
          ...(sessionStorage.getItem('qm_sid')
            ? { 'X-QM-Sid': sessionStorage.getItem('qm_sid') as string }
            : {}),
        },
        body: await buildEncryptedBody(path, { password }),
      });

      if (!res.ok) {
        // 后端可能返回加密或明文错误，尽量解析
        let msg = `导出失败（${res.status}）`;
        try {
          const j = await res.json();
          msg = j?.error || msg;
        } catch {
          /* 忽略 */
        }
        throw new Error(msg);
      }

      // 从 Content-Disposition 提取文件名
      const cd = res.headers.get('content-disposition') || '';
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
      const filename = m ? decodeURIComponent(m[1]) : kind === 'db' ? 'quanming.db' : 'quanming-uploads.zip';

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(kind === 'db' ? '数据库已开始下载' : '图片压缩包已开始下载', {
        description: `${filename} · ${formatBytes(blob.size)}`,
      });
      setPassword('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <div className="glass flex items-center justify-center gap-2 rounded-2xl py-14 text-[13px] text-slate-400">
        <Loader2 className="size-4 animate-spin" /> 正在统计…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 数据概览 */}
      <div className="glass rounded-2xl p-5">
        <h3 className="mb-3 flex items-center gap-2 text-[13.5px] font-medium text-white">
          <HardDrive className="size-4 text-cyan-300" /> 当前数据规模
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { k: '用户', v: info?.counts.users ?? 0, icon: Users },
            { k: '圈名', v: info?.counts.names ?? 0, icon: Sparkles },
            { k: '归属申请', v: info?.counts.claims ?? 0, icon: ShieldAlert },
            { k: '申诉', v: info?.counts.appeals ?? 0, icon: ShieldAlert },
          ].map((i) => (
            <div key={i.k} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
              <div className="text-[10px] text-slate-500">{i.k}</div>
              <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-white">{i.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 密码确认 */}
      <div className="glass rounded-2xl p-5">
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-400/[0.07] px-3 py-2.5 text-[11.5px] leading-relaxed text-amber-200/90">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            导出内容包含全部用户数据与上传材料，属于最高敏感操作。
            请先输入当前账号密码确认身份，导出行为会记录到访问日志。
          </span>
        </div>
        <div className="space-y-2">
          <Label htmlFor="export-pwd">当前账号密码</Label>
          <Input
            id="export-pwd"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入密码以确认导出"
            autoComplete="current-password"
          />
        </div>
      </div>

      {/* 两个导出入口 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="glass rounded-2xl p-5">
          <div className="mb-2 flex items-center gap-2">
            <Database className="size-4 text-violet-300" />
            <h3 className="text-[13.5px] font-medium text-white">完整数据库</h3>
          </div>
          <p className="mb-3 text-[11.5px] leading-relaxed text-slate-500">
            SQLite 数据库快照，包含用户、圈名、申请、申诉、日志等全部表。
            使用在线备份 API 生成，保证导出时数据一致。
          </p>
          <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-500">
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono">
              {info?.database.path}
            </span>
            <span className="tabular-nums">{formatBytes(info?.database.size ?? 0)}</span>
          </div>
          <Button
            className="w-full"
            disabled={busy !== '' || !password.trim()}
            onClick={() => download('db')}
          >
            {busy === 'db' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {busy === 'db' ? '导出中…' : '导出数据库'}
          </Button>
        </div>

        <div className="glass rounded-2xl p-5">
          <div className="mb-2 flex items-center gap-2">
            <FolderArchive className="size-4 text-emerald-300" />
            <h3 className="text-[13.5px] font-medium text-white">全部图片文件</h3>
          </div>
          <p className="mb-3 text-[11.5px] leading-relaxed text-slate-500">
            打包全部上传材料（圈名图片、归属证明材料、用户头像）为 ZIP，
            保留原始目录结构，便于离线归档或迁移。
          </p>
          <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-500">
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5">
              {info?.uploads.count ?? 0} 个文件
            </span>
            <span className="tabular-nums">{formatBytes(info?.uploads.size ?? 0)}</span>
          </div>
          <Button
            className="w-full"
            variant="secondary"
            disabled={busy !== '' || !password.trim() || (info?.uploads.count ?? 0) === 0}
            onClick={() => download('uploads')}
          >
            {busy === 'uploads' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {busy === 'uploads' ? '打包中…' : '导出图片'}
          </Button>
        </div>
      </div>

      <p className={cn('px-1 text-[10.5px] leading-relaxed text-slate-500')}>
        提示：导出文件请妥善保管，内含真实用户信息。建议导出后立即转存到加密存储，并从下载目录删除。
      </p>
    </div>
  );
}
