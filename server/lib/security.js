import crypto from 'node:crypto';

/**
 * 安全中间件集合
 * - 统一安全响应头（CSP / X-Frame-Options / nosniff / Referrer-Policy …）
 * - 请求体原型污染防护
 * - 简单 CSRF 防护（Origin 校验，写操作）
 */

/** 安全响应头 */
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  // HSTS：强制浏览器后续只走 HTTPS，防 SSL 剥离中间人
  // 若在 Nginx/Cloudflare 层已终止 TLS，这里的头同样生效
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_HSTS === '1') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // 防跨站资源嵌入导致的侧信道
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');

  // 页面类请求下发布局级 CSP（接口请求不需要）
  if (!req.path.startsWith('/api')) {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        // Vite 产物需要内联样式；脚本仅允许自身
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join('; '),
    );
  }
  next();
}

/** 阻断原型污染：递归剔除 __proto__ / constructor / prototype 键 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeObject(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeObject(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    out[k] = sanitizeObject(v, depth + 1);
  }
  return out;
}

export function blockPrototypePollution(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }
  next();
}

/**
 * CSRF 防护：写操作校验 Origin/Referer 与 Host 一致
 * 同源部署下浏览器会自动带上 Origin，跨站伪造请求会被拒绝
 */
export function csrfGuard(req, res, next) {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  const host = req.get('host');

  // 无 Origin/Referer 的请求（curl、移动端原生请求）放行，
  // 它们无法携带浏览器 Cookie，不构成 CSRF 场景；浏览器发起的跨站请求必带 Origin
  if (!origin && !referer) return next();

  const sourceHost = (() => {
    try {
      return new URL(origin || referer).host;
    } catch {
      return null;
    }
  })();

  if (sourceHost && host && sourceHost !== host) {
    return res.status(403).json({ error: '请求来源校验失败，请刷新页面后重试', code: 'CSRF_BLOCKED' });
  }
  next();
}

/**
 * 防中间人降级攻击
 * - 生产环境若检测到请求未经 HTTPS（且未声明 trust proxy），拒绝敏感写操作
 * - 同时校验 Sec-Fetch-Site，阻断跨站发起的敏感请求
 */
export function mitmGuard(req, res, next) {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

  // 跨站来源直接拒绝（现代浏览器会带 Sec-Fetch-Site）
  const site = req.get('sec-fetch-site');
  if (site && !['same-origin', 'same-site', 'none'].includes(site)) {
    return res.status(403).json({ error: '跨站请求已被阻止', code: 'CROSS_SITE_BLOCKED' });
  }

  // 仅在明确开启强制 HTTPS 时校验协议，避免本地开发被误拦
  if (process.env.FORCE_HTTPS === '1') {
    const proto = req.get('x-forwarded-proto') || req.protocol;
    if (proto !== 'https' && req.path.startsWith('/api')) {
      return res.status(403).json({
        error: '该操作要求通过 HTTPS 访问，请使用 https:// 打开本站',
        code: 'HTTPS_REQUIRED',
      });
    }
  }

  next();
}

/** 请求 ID，便于日志串联与排查 */
export function requestId(req, res, next) {
  req.id = crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  next();
}
