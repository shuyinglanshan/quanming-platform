export type User = {
  id: string;
  email: string;
  emailDomain: string;
  phone: string;
  phoneMasked: string;
  username: string;
  nickname: string;
  role: 'user' | 'admin' | 'superadmin' | 'assessor';
  roleLabel?: string;
  status: 'active' | 'banned';
  bio: string;
  avatarHue: number;
  avatarUrl?: string;
  title?: string;
  createdAt: string;
  lastLoginAt: string | null;
  bindings: Record<string, { handle: string; boundAt: string; verified: boolean } | null>;
  stats: { claims?: number; approved?: number; rejected?: number };
  bindingUsage?: { month: string; used: number; limit: number; remaining: number; resetAt: string };
  courtPermission?: boolean;
  permissions?: string[];
};

export type NameItem = {
  evidence?: { url: string; name: string; size: number; mime: string }[];
  /** 圈名自定义图片（经审核通过） */
  imageUrl?: string;
  imageSha256?: string;
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
  approvedAt: string;
  views: number;
  status?: string;
  openAppeals?: number;
  owner: {
    id: string;
    nickname: string;
    avatarUrl?: string;
    avatarHue: number;
    bindings: { qq: boolean; wechat: boolean; xiaohongshu: boolean };
  } | null;
};

export type Claim = {
  id: string;
  name: string;
  description: string;
  images: { url: string; name: string; size: number; mime: string; sha256?: string; uploadedAt?: string }[];
  status: 'pending' | 'approved' | 'rejected';
  rejectReason: string;
  reviewedAt: string | null;
  reviewer: string | null;
  createdAt: string;
  updatedAt: string;
  nameId: string | null;
  history?: { at: string; action: string; note?: string; by?: string }[];
  user?: {
    id: string;
    email: string;
    nickname: string;
    avatarHue: number;
    createdAt: string;
    bindings: Record<string, any>;
  };
};

export type Role = 'user' | 'assessor' | 'superadmin' | 'admin';

export type AvatarRequest = {
  id: string;
  userId: string;
  imageUrl: string;
  imageSha256: string;
  imageMime: string;
  imageSize: number;
  /** 审核目标：user=用户头像，name=圈名图片 */
  targetType?: 'user' | 'name';
  targetId?: string | null;
  /** 圈名图片时附带圈名名称 */
  targetName?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectReason: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  user?: {
    id: string;
    username: string;
    nickname: string;
    title: string;
    avatarUrl: string;
    avatarHue: number;
  };
};

export type Notification = {
  id: string;
  type: 'system' | 'personal';
  category: string;
  title: string;
  content: string;
  level: 'info' | 'warning' | 'danger' | 'success' | string;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
  batchId?: string;
  target?: { id: string; nickname: string; email: string } | null;
};

export type Appeal = {
  id: string;
  nameId: string;
  name: string;
  ownerId: string;
  ownerNickname: string;
  reason: string;
  description: string;
  images: { url: string; name: string; size: number; mime: string; sha256?: string }[];
  status: 'pending' | 'approved' | 'rejected';
  rejectReason: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewer: string | null;
  transfer?: boolean;
  user?: {
    id: string;
    email: string;
    nickname: string;
    avatarHue: number;
    createdAt: string;
  };
};

export class ApiError extends Error {
  status: number;
  code?: string;
  payload?: any;
  constructor(message: string, status: number, code?: string, payload?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

/** 需要加密的接口前缀（敏感写操作） */
const ENCRYPT_PREFIXES = [
  '/auth/login',
  '/auth/register',
  '/auth/change-password',
  '/auth/send-code',
  '/auth/login-code',
  '/me/password',
  '/me/phone',
  '/admin',
];

function needsEncryption(path: string, method: string): boolean {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return false;
  return ENCRYPT_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * 统一请求入口：全站双向加密
 *
 * 所有 API（含 GET 只读接口）都：
 *   1. 携带一次性会话密钥头 X-QM-Key
 *   2. 请求体 AES-256-GCM 加密
 *   3. 响应体由服务端用同一把密钥加密，这里解密
 *
 * 因此抓包无法看到任何业务内容（用户列表、圈名、日志等全部为密文）。
 * 文件上传（FormData）与二进制下载走明文通道，由 HTTPS 保护。
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const isForm = init?.body instanceof FormData;

  // FormData / 二进制：不能 JSON 加密，走原生 fetch（仍由 TLS 保护）
  if (isForm) {
    // 文件上传无法做 JSON 信封加密，但会话 ID 仍通过头部参与鉴权
    const { getSessionId } = await import('./crypto');
    const sid = getSessionId();
    const res = await fetch(`/api${path}`, {
      credentials: 'include',
      cache: 'no-store',
      ...init,
      method,
      headers: {
        ...((init?.headers as Record<string, string>) || {}),
        ...(sid ? { 'X-QM-Sid': sid } : {}),
      },
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new ApiError(data?.error || `请求失败（${res.status}）`, res.status, data?.code, data);
    }
    return data as T;
  }

  // 解析请求体
  let payload: unknown;
  if (init?.body && typeof init.body === 'string') {
    try {
      payload = JSON.parse(init.body);
    } catch {
      payload = undefined;
    }
  }

  let result;
  try {
    const { secureFetch } = await import('./crypto');
    result = await secureFetch(`/api${path}`, {
      method,
      body: payload,
      headers: (init?.headers as Record<string, string>) || {},
    });
  } catch (err) {
    // 加密链路本身失败：清公钥缓存并提示刷新
    const { resetKeyCache } = await import('./crypto');
    resetKeyCache();
    throw new ApiError(
      err instanceof Error ? err.message : '安全通道建立失败，请刷新页面',
      0,
      'SECURE_CHANNEL_FAILED',
    );
  }

  const { ok, status, data } = result;

  // 公钥轮换：解密失败时清缓存
  if (!ok && data?.code === 'DECRYPT_FAILED') {
    const { resetKeyCache } = await import('./crypto');
    resetKeyCache();
  }

  /**
   * 会话状态处理
   *
   * 关键区分：
   *   SESSION_EXPIRED      会话真的过期（闲置/被踢/角色变更）→ 弹「登录过期」
   *   SESSION_ID_MISMATCH  SID 与服务端记录不符 → 视为过期
   *   SESSION_ID_REQUIRED  仅表示「本次请求没带 SID」
   *
   * SESSION_ID_REQUIRED 不能直接当成过期：
   *   页面刷新后，AuthProvider 会先请求 /auth/me 重建 SID，
   *   而通知未读数等并发请求可能在此**之前**发出，此时 SID 尚未写入，
   *   若直接弹「登录过期」会造成「一刷新就报过期」的误报。
   *   正确做法：仅清除本地 SID 并静默失败，等 /auth/me 完成后重试。
   */
  if (status === 401) {
    const code = data?.code || '';
    const { setSessionId, getSessionId } = await import('./crypto');

    /**
     * 会话状态处理（关键区分）
     *
     * SESSION_EXPIRED / SESSION_ID_MISMATCH
     *   → 会话**曾经存在但已失效**（闲置/被踢/角色变更）
     *   → 需要弹「登录过期，请重新登录」
     *
     * NOT_AUTHENTICATED
     *   → **从未登录**或 cookie 已清除
     *   → 这是正常状态（游客浏览、刚打开登录页），
     *      **绝对不能弹「会话过期」**
     *   （旧实现把它当过期处理，导致「未登录时切后台回来提示会话过期」）
     *
     * SESSION_ID_REQUIRED
     *   → 本地有 SID 但服务端要求 → 会话失效，需登出
     *   → 本地无 SID（刷新未恢复）→ 静默
     */
    if (code === 'SESSION_EXPIRED' || code === 'SESSION_ID_MISMATCH') {
      setSessionId(null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('qm:session-expired', { detail: data }),
        );
      }
    } else if (code === 'NOT_AUTHENTICATED') {
      // 从未登录：只清本地残留，不提示
      setSessionId(null);
    } else if (code === 'SESSION_ID_REQUIRED') {
      // 区分两种情况：
      //   a) 本地本来就没有 SID（刷新后尚未恢复）→ 静默，等 /auth/me
      //   b) 本地有 SID 但服务端说「需要 SID」→ 说明会话已失效，必须登出
      //      （否则会出现「提示过期但界面仍是登录态」的伪登录态）
      const hadSid = Boolean(getSessionId());
      setSessionId(null);
      if (hadSid && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('qm:session-expired', { detail: { ...data, reason: 'invalid' } }),
        );
      }
    }
  }

  // 会话 ID 生命周期：登录/注册成功即保存，登出即清除
  if (data?.sessionId) {
    const { setSessionId } = await import('./crypto');
    setSessionId(String(data.sessionId));
  }
  if (path === '/auth/logout') {
    const { setSessionId } = await import('./crypto');
    setSessionId(null);
  }

  if (!ok) {
    throw new ApiError(data?.error || `请求失败（${status}）`, status, data?.code, data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
  /**
   * POST：始终发送加密信封
   *
   * 注意 body ?? {} ：即使调用方不传 body，也必须发送空对象，
   * 否则 request() 会跳过加密分支，服务端返回
   * 400 ENCRYPTION_REQUIRED（表现为「提示需要加密请求」）。
   */
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  /**
   * DELETE 也必须有请求体
   *
   * 服务端强制所有写方法（含 DELETE）走加密信封，
   * 而「不传 body」会导致 request() 跳过加密分支，
   * 服务端收到明文请求后返回 400 ENCRYPTION_REQUIRED
   * —— 这正是「删除用户提示需要加密请求」的原因。
   *
   * 这里统一发送空对象 {}，保证始终进入加密流程。
   */
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'DELETE',
      body: JSON.stringify(body ?? {}),
    }),
};

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};

export type FeedbackKind = { key: string; label: string; hint: string };

export type Feedback = {
  id: string;
  kind: string;
  kindLabel: string;
  kindOther: string;
  title: string;
  content: string;
  contact: string;
  pagePath: string;
  imageUrl: string;
  status: 'pending' | 'read' | 'replied' | 'closed';
  readAt: string | null;
  reply: string;
  repliedAt: string | null;
  repliedBy: string | null;
  createdAt: string;
  user?: {
    id: string;
    nickname: string;
    username: string;
    email: string;
    avatarUrl: string;
    avatarHue: number;
  } | null;
};

/* ---------------- 小法庭 ---------------- */
export type CourtSide = 'claimant' | 'respondent';

export type CourtStatement = {
  id: string;
  side: CourtSide;
  round: number;
  content: string;
  images: { url: string; name: string; size: number; mime: string }[];
  createdAt: string;
  user: { id: string; nickname: string; avatarHue: number; avatarUrl: string } | null;
};

export type CourtVoteDetail = {
  id: string;
  side: CourtSide;
  reason: string;
  createdAt: string;
  user: { id: string; nickname: string; avatarHue: number; avatarUrl: string } | null;
};

export type Court = {
  id: string;
  nameId: string;
  nameText: string;
  status: 'pending' | 'running' | 'voting' | 'closed';
  createdAt: string;
  startedAt: string | null;
  votingEndsAt: string | null;
  closedAt: string | null;
  winnerId: string | null;
  verdict: 'votes' | 'admin' | null;
  verdictReason: string;
  judgedBy: string | null;
  claimant: { id: string; nickname: string; avatarHue: number; avatarUrl: string; title: string } | null;
  respondent: { id: string; nickname: string; avatarHue: number; avatarUrl: string; title: string } | null;
  votes: { claimant: number; respondent: number; total: number };
  viewer: { isClaimant: boolean; isRespondent: boolean; votedSide: CourtSide | null } | null;
  statements?: CourtStatement[];
  voteDetails?: CourtVoteDetail[];
};
