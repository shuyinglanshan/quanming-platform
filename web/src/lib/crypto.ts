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

type PubKey = { publicKey: string; kid: string; algorithm: string };

let cachedKey: { key: CryptoKey; kid: string } | null = null;
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
  cachedKey = { key, kid: data.kid };
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

/** 加密任意 JSON 对象 */
export async function encryptBody(payload: unknown): Promise<{ enc: Record<string, string> }> {
  const pub = await getPublicKey();

  const aesKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const aes = await crypto.subtle.importKey('raw', aesKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, plaintext);

  // WebCrypto 的 AES-GCM 输出 = 密文 || 16 字节 tag，需拆分
  const cipher = new Uint8Array(cipherBuf);
  const tagLen = 16;
  const data = cipher.slice(0, cipher.length - tagLen);
  const tag = cipher.slice(cipher.length - tagLen);

  const encKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, aesKey);

  return {
    enc: {
      key: b64(encKey),
      iv: b64(iv),
      data: b64(data),
      tag: b64(tag),
    },
  };
}

/** 浏览器是否支持所需加密能力 */
export function isCryptoSupported(): boolean {
  return typeof crypto !== 'undefined' && Boolean(crypto.subtle) && typeof crypto.subtle.encrypt === 'function';
}
