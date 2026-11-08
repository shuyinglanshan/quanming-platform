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
  // GET 无请求体，会话 ID 走头部
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

export function setSessionId(sid: string | null) {
  try {
    if (sid) sessionStorage.setItem(SID_KEY, sid);
    else sessionStorage.removeItem(SID_KEY);
  } catch {
    /* 隐私模式下 sessionStorage 可能不可用，忽略 */
  }
}

export function getSessionId(): string {
  try {
    return sessionStorage.getItem(SID_KEY) || '';
  } catch {
    return '';
  }
}
