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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const isForm = init?.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...((init?.headers as Record<string, string>) || {}),
  };

  let body = init?.body as BodyInit | undefined;

  // 敏感字段：transparent 加密（失败则降级为明文，由服务端兼容）
  if (!isForm && body && typeof body === 'string' && needsEncryption(path, method)) {
    try {
      const { encryptBody } = await import('./crypto');
      const plain = JSON.parse(body);
      const envelope = await encryptBody(plain, `/api${path}`, method);
      body = JSON.stringify(envelope);
      headers['X-Encrypted'] = '1';
    } catch (err) {
      console.warn('[api] 请求加密失败，降级为明文传输', err);
    }
  }

  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    method,
    headers,
    body,
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  // 公钥轮换：解密失败时清缓存，下次自动重新拉取
  if (!res.ok && data?.code === 'DECRYPT_FAILED') {
    const { resetKeyCache } = await import('./crypto');
    resetKeyCache();
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `请求失败（${res.status}）`, res.status, data?.code, data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'DELETE',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
