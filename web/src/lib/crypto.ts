/**
 * 前端应用层加密（Base64 + RSA-OAEP + AES-256-GCM）
 *
 * 流程：
 *   1. 拉取并缓存服务端 RSA 公钥
 *   2. 每次请求生成随机 32 字节 AES 密钥 + 12 字节 IV
 *   3. 用 RSA-OAEP(SHA-256) 加密 AES 密钥
 *   4. 用 AES-256-GCM 加密请求体，得到密文 + 认证标签
 *   5. 整体 base64 编码后作为 { enc: {...} } 发送
 */

type PubKey = { publicKey: string; kid: string; v: number; bits: number; algorithm: string };

let cachedKey: { key: CryptoKey; kid: string; v: number } | null = null;
let pending: Promise<CryptoKey> | null = null;

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

async function fetchPublicKey(): Promise<CryptoKey> {
  const res = await fetch('/api/crypto/pubkey', { cache: 'no-store' });
  if (!res.ok) throw new Error('获取加密公钥失败');
  const data = (await res.json()) as PubKey;
  if (!data?.publicKey || !data?.kid || Number(data.v) !== 2) {
    throw new Error('服务端加密协议版本不匹配');
  }

  // PEM -> ArrayBuffer
  const pemBody = data.publicKey
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'spki',
    raw,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  cachedKey = { key, kid: data.kid, v: 2 };
  return key;
}

export async function getPublicKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey.key;
  if (!pending) {
    pending = fetchPublicKey().finally(() => {
      pending = null;
    });
  }
  return pending;
}

/** 公钥轮换时清除缓存 */
export function resetKeyCache() {
  cachedKey = null;
}

/** 生成 base64url 随机串（用于一次性 nonce） */
function randomNonce(bytes = 16): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function encryptWithKey(
  pub: CryptoKey,
  payload: unknown,
  path: string,
  method: string,
): Promise<{ enc: Record<string, string | number> }> {
  const aesKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`qm:v2|${method.toUpperCase()}|${path}`);

  const aes = await crypto.subtle.importKey('raw', aesKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      // 业务字段先展开，协议字段统一用 _qm_ 前缀，避免与业务字段（如注册的 method）冲突
      ...(payload as Record<string, unknown>),
      _qm_ts: Date.now(),
      _qm_nonce: randomNonce(),
      _qm_path: path,
      _qm_method: method.toUpperCase(),
      // 会话 ID 随密文一起发送（攻击者拿到 cookie 也伪造不了）
      ...(getSessionId() ? { _qm_sid: getSessionId() } : {}),
    }),
  );
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, aes, plaintext);

  // WebCrypto 的 AES-GCM 输出 = 密文 || 16 字节 tag，需拆分
  const cipher = new Uint8Array(cipherBuf);
  const tagLen = 16;
  const data = cipher.slice(0, cipher.length - tagLen);
  const tag = cipher.slice(cipher.length - tagLen);

  const encKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, aesKey);

  return {
    enc: {
      v: 2,
      kid: cachedKey?.kid || '',
      key: b64(encKey),
      iv: b64(iv),
      data: b64(data),
      tag: b64(tag),
    },
  };
}

/**
 * 加密任意 JSON 对象
 * 明文内同时携带 ts / nonce / path / method，服务端据此完成：
 *   - 时间戳有效期校验（默认 5 分钟）
 *   - nonce 一次性校验，防止密文原样重放
 *   - 请求地址与方法绑定校验，防止跨接口重放
 * 密文额外使用 AES-GCM AAD 绑定 method/path，与 kid 版本校验共同拦截旧密钥与跨接口重放。
 */
export async function encryptBody(
  payload: unknown,
  path = '',
  method = 'POST',
): Promise<{ enc: Record<string, string | number> }> {
  const pub = await getPublicKey();
  return encryptWithKey(pub, payload, path, method);
}

/** 浏览器是否支持所需加密能力 */
export function isCryptoSupported(): boolean {
  return typeof crypto !== 'undefined' && Boolean(crypto.subtle) && typeof crypto.subtle.encrypt === 'function';
}

/* ============================================================
 * 全站双向加密
 *
 * 每个请求：
 *   1. 生成一次性 32 字节 AES 密钥
 *   2. 用 RSA-OAEP 加密该密钥 → 放进 X-QM-Key 头
 *   3. 请求体（若有）用同一把密钥 AES-GCM 加密
 *   4. 服务端用同一把密钥加密响应，前端用同一把密钥解密
 *
 * 这样整条链路（请求 + 响应）都是密文，抓包看不到任何业务内容。
 * 会话密钥每次请求都不同，天然具备前向安全性。
 * ============================================================ */

/** 生成一次性会话密钥对（AES 密钥 + RSA 加密后的头值） */
async function newSessionKey(): Promise<{ aesKey: CryptoKey; header: string }> {
  const pub = await getPublicKey();
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const headerBuf = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw);
  const aesKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  return { aesKey, header: b64(headerBuf) };
}

/** 用会话密钥加密请求体 */
async function encryptWithSession(
  aesKey: CryptoKey,
  payload: unknown,
  path: string,
  method: string,
): Promise<{ iv: string; data: string; tag: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // 与后端 buildAAD 完全一致：qm:v2|METHOD|path
  const aadStr = `qm:v2|${method.toUpperCase()}|${path}`;
  const aad = new TextEncoder().encode(aadStr);
  const plain = new TextEncoder().encode(
    JSON.stringify({
      ...(payload as object),
      _qm_ts: Date.now(),
      // nonce 必须匹配后端规则 [A-Za-z0-9_-]{16,64}，故用 base64url 且去掉填充
      _qm_nonce: b64(crypto.getRandomValues(new Uint8Array(16)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      // 必须携带 path/method，后端据此做双重绑定校验（防跨接口重放）
      _qm_path: path,
      _qm_method: method.toUpperCase(),
      // 会话 ID 随密文一起发送（攻击者拿到 cookie 也伪造不了）
      ...(getSessionId() ? { _qm_sid: getSessionId() } : {}),
    }),
  );
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    aesKey,
    plain,
  );
  const full = new Uint8Array(buf);
  const tagLen = 16;
  return {
    iv: b64(iv),
    data: b64(full.slice(0, full.length - tagLen)),
    tag: b64(full.slice(full.length - tagLen)),
  };
}

/** 解密响应体 */
export async function decryptResponse(
  aesKey: CryptoKey,
  enc: { iv: string; data: string; tag: string },
): Promise<any> {
  const iv = Uint8Array.from(atob(enc.iv), (c) => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(enc.tag), (c) => c.charCodeAt(0));
  const data = Uint8Array.from(atob(enc.data), (c) => c.charCodeAt(0));
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data, 0);
  combined.set(tag, data.length);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('response'), tagLength: 128 },
    aesKey,
    combined,
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * 发起一次全加密请求
 * @returns 解密后的响应数据
 */
export async function secureFetch(
  url: string,
  init: { method: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ ok: boolean; status: number; data: any }> {
  const { aesKey, header } = await newSessionKey();
  const headers: Record<string, string> = {
    'X-QM-Key': header,
    ...(init.headers || {}),
  };
  // 刷新后 SID 可能尚未恢复，先等一小会儿（避免误报过期）
  await waitSidReady();
  const sid = getSessionId();
  if (sid) headers['X-QM-Sid'] = sid;

  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    // path 用真实 API 路径（不含 /api 前缀的差异由调用方保证）
    // AAD 必须与后端 req.path 完全一致（含 /api 前缀），否则认证标签校验失败
    const path = url.startsWith('/api') ? url : `/api${url}`;
    const enc = await encryptWithSession(aesKey, init.body, path, init.method);
    // 信封必须包含 key（RSA 加密的 AES 会话密钥），否则后端判定格式不合法
    body = JSON.stringify({ enc: { v: 2, kid: currentKid(), key: header, ...enc } });
    headers['X-Encrypted'] = '1';
  }

  const res = await fetch(url, {
    method: init.method,
    headers,
    body,
    credentials: 'include',
    cache: 'no-store',
  });

  // 服务端在 SID 缺失/过期时会通过响应头回填正确值，
  // 前端自动同步，避免下次请求继续用旧 SID 而被拒
  const sidRefresh = res.headers.get('x-qm-sid-refresh');
  if (sidRefresh) {
    setSessionId(sidRefresh);
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  // 响应密文则解密
  if (data && data.enc && res.headers.get('x-qm-encrypted') === '1') {
    try {
      data = await decryptResponse(aesKey, data.enc);
    } catch (err) {
      console.warn('[crypto] 响应解密失败', err);
      throw new Error('响应解密失败，请刷新页面重试');
    }
  }

  return { ok: res.ok, status: res.status, data };
}

/** 当前公钥标识（用于信封 kid 校验） */
function currentKid(): string {
  return cachedKey?.kid || '';
}

/* ============================================================
 * 会话 ID 管理
 *
 * 登录后服务端返回 sessionId（形如 A-K7M2XP9QRT4NVW8YHZ3BCD5）。
 * 之后每个请求都把它一起加密发送，服务端据此做二次身份确认：
 *   - 只偷到 cookie 没有 sessionId → 拒绝
 *   - sessionId 与 token 不是同一次登录 → 拒绝
 *
 * 存 sessionStorage 而非 localStorage：关闭标签页即失效，更安全。
 * ============================================================ */
const SID_KEY = 'qm_sid';
/**
 * SID 持久副本
 *
 * sessionStorage 在刷新时会被保留（同一标签页），
 * 但如果首个请求早于 React 挂载完成，仍可能读不到。
 * 这里再加一份 localStorage 副本作为兜底：
 *   · 读取优先 sessionStorage → localStorage
 *   · 写入时两边同步
 *   · 登出时两边清除
 *
 * 安全性：SID 本身不是凭证（cookie 才是），
 * 它只是「本次会话的标识」，即使泄露也无法单独冒充登录。
 */
const SID_PERSIST_KEY = 'qm_sid_p';

/**
 * SID 就绪闸门
 *
 * 页面刷新后，sessionStorage 中的 SID 可能尚未被 AuthProvider 写入，
 * 此时并发的业务请求会因缺少 SID 被服务端拒绝。
 *
 * 这里用一个轻量闸门：AuthProvider 恢复会话后调用 markSidReady()，
 * 期间发出的请求最多等待 1.5 秒，避免刷新瞬间的误报。
 */
let sidReady = false;
let sidReadyResolve: (() => void) | null = null;
let sidReadyPromise = new Promise<void>((resolve) => {
  sidReadyResolve = resolve;
});

export function markSidReady() {
  if (sidReady) return;
  sidReady = true;
  sidReadyResolve?.();
}

/**
 * 重置闸门（SID 被清除时调用）
 *
 * 问题：sidReady 是模块级变量，首次 /auth/me 完成后置为 true 就不再变化。
 *   用户登出后 setSessionId(null)，闸门仍开着，
 *   此时任何请求都会「立即通过闸门」并带着空 SID 发出，
 *   服务端返回 401 SESSION_ID_REQUIRED，
 *   前端误判为「会话已过期」并弹提示 —— 这就是
 *   「未登录时切后台再回来自动提示会话过期」的根因。
 *
 * 修复：清除 SID 时同步把闸门关上，下次需要重新等待 /auth/me 恢复。
 */
function resetSidReady() {
  if (!sidReady && sidReadyResolve) return;
  sidReady = false;
  sidReadyPromise = new Promise<void>((resolve) => {
    sidReadyResolve = resolve;
  });
}

/** 等待 SID 就绪（最多 timeout 毫秒，避免永久阻塞） */
export async function waitSidReady(timeout = 1500): Promise<void> {
  if (getSessionId()) return;
  // 没有 SID 且闸门未开：说明正在等待会话恢复，短暂等待
  if (!sidReady) {
    await Promise.race([sidReadyPromise, new Promise((r) => setTimeout(r, timeout))]);
  }
}

export function setSessionId(sid: string | null) {
  try {
    if (sid) {
      sessionStorage.setItem(SID_KEY, sid);
      localStorage.setItem(SID_PERSIST_KEY, sid);
    } else {
      sessionStorage.removeItem(SID_KEY);
      localStorage.removeItem(SID_PERSIST_KEY);
      // 清除 SID 时同步关闭闸门，避免后续请求带着空 SID 触发误报
      resetSidReady();
    }
  } catch {
    /* 隐私模式下存储可能不可用，忽略 */
  }
}

export function getSessionId(): string {
  try {
    // 优先 sessionStorage（当前标签页），回退 localStorage（刷新后兜底）
    return sessionStorage.getItem(SID_KEY) || localStorage.getItem(SID_PERSIST_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * 生成可直接发送的加密信封
 *
 * 供「需要自行控制 fetch（如文件下载）」的调用方使用，
 * 保证这些请求同样满足服务端的强制加密要求。
 *
 * @param path 完整 API 路径（含 /api 前缀）
 * @param payload 业务数据
 * @param method HTTP 方法
 */
export async function encryptForRequest(
  path: string,
  payload: Record<string, unknown>,
  method = 'POST',
): Promise<{ enc: Record<string, string | number> }> {
  const { aesKey, header } = await newSessionKey();
  const enc = await encryptWithSession(aesKey, payload, path, method);
  return {
    enc: { v: 2, kid: currentKid(), key: header, ...enc } as Record<string, string | number>,
  };
}
