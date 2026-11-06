import { isEncryptedEnvelope, decryptPayload } from './crypto-layer.js';
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

/** 仅作用于写操作与登录类接口，GET 不需要加密 */
const PROTECTED_PREFIXES = ['/api/auth', '/api/me', '/api/claims', '/api/appeals', '/api/admin'];

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

export function decryptRequest(req, res, next) {
  if (!shouldDecrypt(req)) return next();
  if (!isEncryptedEnvelope(req.body)) {
    // 带 enc 字段但字段不全（或旧版 v1 信封）：明确拒绝，不能当成明文放行
    if (req.body && typeof req.body === 'object' && req.body.enc) {
      return res.status(400).json({ error: '加密请求格式不正确，请刷新页面后重试', code: 'DECRYPT_FAILED' });
    }
    // 生产环境拒绝敏感接口的明文凭据请求，防止降级为明文被中间人窃取
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
