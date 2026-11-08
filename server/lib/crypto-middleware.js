import { isEncryptedEnvelope, decryptPayload, decryptLastAesKey, encryptResponse, parseSessionKey } from './crypto-layer.js';
import { trustedClientIp } from './ip.js';
import { eventLog } from './logger.js';

/**
 * 加密请求解密中间件
 *
 * 约定：客户端把敏感字段放进 `{ enc: { key, iv, data, tag } }`，
 * 服务端在本中间件里还原为 req.body，后续路由代码无需感知加密细节。
 *
 * 安全措施：
 *   - 解密失败统一返回 400，不泄漏具体原因（避免填充预言）
 *   - 记录失败次数用于风控
 *   - 加密与明文请求可共存（兼容旧客户端 / 服务端直连）
 */

const failures = new Map(); // ip -> { count, resetAt }
const WINDOW = 60_000;
const MAX_FAIL_PER_WINDOW = 20;

/** 所有 /api 路径都参与解密（GET 也可带会话 ID 头） */
const PROTECTED_PREFIXES = ['/api'];

/**
 * 生产环境强制加密的敏感接口（JSON 请求体）
 * 这些接口涉及密码、验证码等凭据，明文传输等于把凭据暴露在中间人面前。
 * 前端已统一接入加密；如确有明文脚本调用需求，可设置 ALLOW_PLAINTEXT_SENSITIVE=1。
 */
const STRICT_PATHS = new Set([
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/login-code',
  '/api/auth/send-code',
  '/api/auth/change-password',
  '/api/me/password',
  '/api/me/phone',
]);

const REQUIRE_ENCRYPTED =
  process.env.REQUIRE_ENCRYPTED === '1' ||
  (process.env.NODE_ENV === 'production' && process.env.ALLOW_PLAINTEXT_SENSITIVE !== '1');

function shouldDecrypt(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return false;
  return PROTECTED_PREFIXES.some((p) => req.path.startsWith(p));
}

function tooManyFailures(ip) {
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || rec.resetAt < now) return false;
  return rec.count >= MAX_FAIL_PER_WINDOW;
}

function noteFailure(ip) {
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || rec.resetAt < now) {
    failures.set(ip, { count: 1, resetAt: now + WINDOW });
  } else {
    rec.count += 1;
  }
  if (failures.size > 5000) {
    for (const [k, v] of failures) if (v.resetAt < now) failures.delete(k);
  }
}

/** 低风险只读接口：豁免会话 ID 校验（浏览圈名、热榜等） */
const LOW_RISK_GET = [
  /^\/api\/names$/,          // 圈名列表
  /^\/api\/names\/hot/,      // 热榜
  /^\/api\/names\/stats/,    // 公开统计
  /^\/api\/names\/suggest/,  // 搜索建议
  /^\/api\/names\/[\w-]+$/ , // 圈名详情
  /^\/api\/crypto\/pubkey/,  // 公钥
  /^\/api\/auth\/me$/,       // 恢复登录态（此时尚无 SID）
  /^\/api\/health/,          // 健康检查
  /^\/api\/feedback\/kinds/, // 反馈类型
];

export function isLowRiskRequest(req) {
  if (req.method.toUpperCase() !== 'GET') return false;
  const path = req.path.split('?')[0];
  return LOW_RISK_GET.some((re) => re.test(path));
}

export function decryptRequest(req, res, next) {
  // GET 也可以带会话 ID（头部），供鉴权使用
  const sidHeader = req.get('x-qm-sid');
  if (sidHeader) req.sessionIdFromHeader = String(sidHeader).slice(0, 64);

  if (!shouldDecrypt(req)) return next();
  if (!isEncryptedEnvelope(req.body)) {
    // 带 enc 字段但字段不全（或旧版 v1 信封）：明确拒绝，不能当成明文放行
    if (req.body && typeof req.body === 'object' && req.body.enc) {
      return res.status(400).json({ error: '加密请求格式不正确，请刷新页面后重试', code: 'DECRYPT_FAILED' });
    }
    // 强制：所有写方法（POST/PUT/PATCH/DELETE）必须加密，
    // 仅文件上传（multipart）例外 —— 二进制无法做 JSON 信封加密
    const isMultipart = (req.get('content-type') || '').includes('multipart/form-data');
    const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
    // 走到这里说明请求体不是加密信封，写方法一律拒绝
    if (isWriteMethod && !isMultipart) {
      eventLog(req, '拒绝明文写请求', `${req.method} ${req.path}`, 'error');
      return res.status(400).json({
        error: '该操作必须使用加密请求，请刷新页面后重试',
        code: 'ENCRYPTION_REQUIRED',
      });
    }

    // 兼容旧开关：仍在 STRICT_PATHS 内的接口额外校验
    if (REQUIRE_ENCRYPTED && STRICT_PATHS.has(req.path)) {
      eventLog(req, '拒绝明文敏感请求', `${req.method} ${req.path}`, 'error');
      return res.status(400).json({
        error: '该操作必须使用加密请求，请刷新页面后重试',
        code: 'ENCRYPTION_REQUIRED',
      });
    }
    return next();
  }

  // 使用与限流一致的受信客户端 IP，避免伪造 X-Forwarded-For 绕过解密失败计数
  const ip = trustedClientIp(req) || req.socket?.remoteAddress || 'unknown';
  if (tooManyFailures(ip)) {
    return res.status(429).json({ error: '解密失败次数过多，请稍后再试', code: 'DECRYPT_RATE_LIMITED' });
  }

  try {
    const plain = decryptPayload(req.body.enc, { path: req.path, method: req.method });
    if (!plain || typeof plain !== 'object' || Array.isArray(plain)) {
      throw new Error('解密结果格式不正确');
    }
    // 只移除协议层字段（_qm_ 前缀）；兼容旧客户端时额外删除无前缀的同名字段，
    // 但**不能**误删业务字段：例如注册接口的 method 承载 'phone' | 'email'
    // 提取会话 ID（随密文一起传输，攻击者即使拿到 cookie 也无法伪造）
    if (plain._qm_sid) {
      req.sessionIdFromBody = String(plain._qm_sid).slice(0, 64);
      delete plain._qm_sid;
    }
    delete plain._qm_ts;
    delete plain._qm_nonce;
    delete plain._qm_path;
    delete plain._qm_method;
    if (plain._qm_ts === undefined) {
      // 旧协议回退路径
      delete plain.ts;
      delete plain.nonce;
      delete plain.path;
      // 注意：不删除 plain.method，避免破坏注册方式等业务语义
    }
    req.body = plain;
    req.encrypted = true;
    // 保存本次请求的 AES 会话密钥，响应加密复用它
    // （避免客户端需要额外维护两套密钥，也更省一次 RSA 运算）
    req.qmAesKey = decryptLastAesKey();
    next();
  } catch (err) {
    noteFailure(ip);
    // 不回显具体错误，避免被用于探测
    eventLog(req, '加密请求解密失败', String(err.message || '').slice(0, 80), 'error');
    return res.status(400).json({ error: '请求内容校验失败，请刷新页面后重试', code: 'DECRYPT_FAILED' });
  }
}

/** 供后台查看解密失败情况 */
export function cryptoStats() {
  const now = Date.now();
  const list = [...failures.entries()]
    .filter(([, v]) => v.resetAt > now)
    .map(([ip, v]) => ({ ip, count: v.count, resetIn: Math.ceil((v.resetAt - now) / 1000) }));
  return { activeWindows: list.length, top: list.sort((a, b) => b.count - a.count).slice(0, 10) };
}

/* ============================================================
 * 响应加密中间件
 *
 * 客户端在请求头里带上 X-QM-Key（RSA 加密的 AES 会话密钥）。
 * 若存在，则把 res.json 的响应体整体加密为密文：
 *   { enc: { v, iv, data, tag }, encrypted: true }
 *
 * 目的：让抓包者即使截获流量，也看不到任何接口内容
 *      （包括用户列表、日志、圈名数据等）。
 *
 * 兼容：未携带 X-QM-Key 的请求走明文（用于 /api/health 等探活，
 *      以及渐进式上线；可通过 REQUIRE_ENCRYPTED=1 强制）。
 * ============================================================ */
export function encryptResponseMiddleware(req, res, next) {
  // 优先复用请求信封里的 AES 密钥（同一把密钥加解密更省事，且天然一一对应）
  // 其次才读 X-QM-Key 头（兼容仅 GET 的只读请求）
  let aesKey = req.qmAesKey || null;
  if (!aesKey) {
    const keyHeader = req.get('x-qm-key');
    if (keyHeader) {
      aesKey = parseSessionKey(keyHeader);
      // 带了密钥头却解不出来 → 明确拒绝，
      // 不能静默降级为明文响应（否则等于加密可被绕过）
      if (!aesKey) {
        return res.status(400).json({
          error: '响应加密密钥无效，请刷新页面后重试',
          code: 'RESPONSE_KEY_INVALID',
        });
      }
    }
  }
  if (!aesKey) return next();

  if (!Buffer.isBuffer(aesKey) || aesKey.length !== 32) {
    return res.status(400).json({
      error: '响应加密密钥无效，请刷新页面后重试',
      code: 'RESPONSE_KEY_INVALID',
    });
  }

  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    try {
      res.setHeader('x-qm-encrypted', '1');
      res.setHeader('Cache-Control', 'no-store');
      return originalJson({ enc: encryptResponse(aesKey, payload) });
    } catch (err) {
      console.error('[crypto] 响应加密失败:', err.message);
      res.status(500);
      return originalJson({ error: '响应加密失败', code: 'RESPONSE_ENCRYPT_FAILED' });
    }
  };

  next();
}
