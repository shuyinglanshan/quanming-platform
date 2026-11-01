import 'dotenv/config';

// 统一使用东八区，避免服务器时区与用户不一致导致统计分桶偏移
process.env.TZ = process.env.TZ || 'Asia/Shanghai';

import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashPassword, pepperStatus } from './lib/password.js';

import { db, persistNow, UPLOAD_DIR, ROOT, uid } from './lib/db.js';
import { attachUser } from './lib/auth.js';
import { requestLogger } from './lib/logger.js';
import { isMailConfigured } from './lib/mailer.js';
import { rateGuard, securitySnapshot } from './lib/guard.js';
import { securityHeaders, blockPrototypePollution, csrfGuard, requestId, mitmGuard } from './lib/security.js';
import { decryptRequest } from './lib/crypto-middleware.js';
import { getPublicKey, ensureKeyPair } from './lib/crypto-layer.js';

import authRoutes from './routes/auth.js';
import nameRoutes from './routes/names.js';
import claimRoutes from './routes/claims.js';
import appealRoutes from './routes/appeals.js';
import meRoutes from './routes/me.js';
import notificationRoutes from './routes/notifications.js';
import adminRoutes from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
// 安全：默认不信任任何代理，避免 X-Forwarded-For 伪造绕过 IP 限流
// 部署在 Nginx 等反代之后时，请设置 TRUST_PROXY=1 与 TRUSTED_PROXIES=<反代IP/CIDR>
app.set('trust proxy', /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || '')));
app.disable('x-powered-by');

app.use(requestId);
app.use(securityHeaders);
app.use(express.json({ limit: '2mb' }));
// extended: false 可避免 qs 的嵌套解析带来的原型污染面
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(cookieParser());
app.use(blockPrototypePollution);
app.use(csrfGuard);
// 防中间人：阻断跨站敏感请求，可选强制 HTTPS
app.use(mitmGuard);
// 应用层加密：还原客户端加密的请求体（明文请求自动放行）
app.use(decryptRequest);
// 日志先于风控挂载，保证被限流的请求同样被记录，便于事后排查误伤
app.use(requestLogger);
app.use(rateGuard);
app.use(attachUser);

/* ---------------- API ---------------- */
/* 客户端加密所需的 RSA 公钥 */
app.get('/api/crypto/pubkey', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(getPublicKey());
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: '小天才圈名平台',
    mailConfigured: isMailConfigured(),
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/names', nameRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/appeals', appealRoutes);
app.use('/api/me', meRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));

/* ---------------- 静态资源 ---------------- */
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '7d',
    setHeaders(res, filePath) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // 上传目录一律沙箱化：即使被放入可执行内容也无法运行脚本
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      );
      // 强制按附件下载非图片资源，避免被浏览器当作页面渲染
      if (!/\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(filePath)) {
        res.setHeader('Content-Disposition', 'attachment');
      }
      // 双重保险：即使有脚本文件混入，也强制按纯文本下载，绝不被服务端/浏览器执行
      if (/\.(php|phtml|phar|jsp|asp|aspx|cgi|pl|py|sh|bash|js|mjs|html?|svg|xml)$/i.test(filePath)) {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment');
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }
    },
  }),
);

const WEB_DIST = path.resolve(ROOT, '..', 'web', 'dist');
if (fs.existsSync(WEB_DIST)) {
  app.use(
    express.static(WEB_DIST, {
      index: false,
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  /**
   * SPA fallback 收敛
   * 只对明确存在的前端路由返回 index.html，其余一律 404。
   * 早期用通配 100% 返回 200，会让扫描器/安全设备无法区分真实与虚假路径，
   * 也会掩盖配置错误（例如 Nginx 误挂载静态目录）。
   */
  const SPA_ROUTES = [
    '/',
    '/login',
    '/register',
    '/about',
    '/me',
    '/notifications',
    '/admin',
    /^\/names\/[A-Za-z0-9_-]{1,64}$/,
  ];

  const isSpaRoute = (p) =>
    SPA_ROUTES.some((r) => (typeof r === 'string' ? r === p : r.test(p)));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    // 疑似探测敏感文件（带扩展名或隐藏文件）一律 404，不回落到首页
    const looksLikeFile = /\.[a-z0-9]{1,8}$/i.test(req.path) || /(^|\/)\./.test(req.path);
    if (looksLikeFile) {
      return res.status(404).type('text/plain; charset=utf-8').send('Not Found');
    }
    if (!isSpaRoute(req.path)) {
      return res.status(404).type('text/plain; charset=utf-8').send('Not Found');
    }
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('html').send(
      `<pre style="font:14px/1.7 ui-monospace,monospace;padding:32px">小天才圈名平台 API 已启动 ✅
前端尚未构建。开发模式请运行： cd web && npm run dev
生产构建请运行：      cd web && npm run build
接口健康检查：        /api/health</pre>`,
    );
  });
}

/* ---------------- 错误处理 ---------------- */
app.use((err, _req, res, _next) => {
  // 响应已开始发送时不能再写头部，否则连接会挂起
  if (res.headersSent) {
    console.error('[error] 响应已发送后发生错误:', err?.message);
    return res.destroy();
  }
  // 请求体超限（express.json / urlencoded）
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '请求内容过大，请精简后重试' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求格式不正确' });
  }
  if (err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported') {
    return res.status(415).json({ error: '不支持的内容编码' });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '单张图片不能超过 8MB' });
  if (err?.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: '一次最多上传 6 张图片' });
  // 上传校验类错误统一 415（multer fileFilter 抛出的业务错误）
  if (
    err?.code === 'LIMIT_UNEXPECTED_FILE' ||
    /仅支持|仅允许|禁止上传|扩展名|多重扩展|文件名|不是有效图片|校验失败/i.test(err?.message || '')
  ) {
    return res.status(415).json({ error: err.message || '文件类型不被允许' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: '服务器开小差了，请稍后重试' });
});

/* ---------------- 启动 ---------------- */
/** 空库时只创建首个管理员账号，不写入任何示例业务数据 */
/** 生成随机管理员用户名，例如 qm_admin_7f3a2c */
function randomUsername() {
  const suffix = crypto.randomBytes(3).toString('hex');
  return `qm_admin_${suffix}`;
}

/** 生成强随机密码：大小写字母 + 数字 + 符号，共 16 位 */
function randomPassword(length = 16) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = upper + lower + digits + symbols;
  const pick = (chars) => chars[crypto.randomInt(0, chars.length)];

  // 先各取一位保证字符类型齐全，其余随机填充后打乱
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * 首次启动创建管理员
 * 用户名与密码随机生成并打印到控制台，不写入任何配置文件；
 * 如需固定账号，可在 .env 中显式指定 ADMIN_USERNAME / ADMIN_PASSWORD。
 */
function ensureFirstAdmin() {
  if (db.users.length > 0) return null;

  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const emailValid = /^[a-z0-9._%+-]+@qq\.com$/.test(email);

  // 用户名：优先使用 .env 指定值，否则随机生成
  const envUsername = String(process.env.ADMIN_USERNAME || '').trim();
  const username = /^[a-zA-Z][a-zA-Z0-9_]{3,19}$/.test(envUsername) ? envUsername : randomUsername();

  // 密码：优先使用 .env 指定值，否则随机生成
  const envPassword = String(process.env.ADMIN_PASSWORD || '');
  let password = envPassword;
  let generated = false;
  if (!password) {
    password = randomPassword();
    generated = true;
  } else if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    console.error('');
    console.error('  ✗ .env 中的 ADMIN_PASSWORD 强度不足：至少 8 位，且需同时包含字母与数字');
    console.error('');
    process.exit(1);
  }

  const admin = {
    id: uid('u_'),
    email: emailValid ? email : '',
    emailDomain: emailValid ? 'qq.com' : '',
    phone: '',
    username,
    nickname: process.env.ADMIN_NICKNAME || '平台管理员',
    passwordHash: hashPassword(password),
    role: 'admin',
    status: 'active',
    bio: '',
    avatarHue: 268,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    loginCount: 0,
    bindings: { wechat: null, qq: null, xiaohongshu: null },
    bindingChanges: { month: '', count: 0 },
    stats: { claims: 0, approved: 0, rejected: 0 },
  };
  db.users.push(admin);
  persistNow();

  // 仅用于启动时打印一次，不落库
  admin.__plainPassword = password;
  admin.__generated = generated;
  return admin;
}

function bootstrap() {
  // 应用层加密密钥（RSA-2048），首次启动自动生成
  ensureKeyPair();

  const pepper = pepperStatus();
  if (pepper.source === 'generated') {
    console.log(`  ✦ 已自动生成密码 pepper（${pepper.length} 位）并保存到 data/keys/pepper.key`);
  }

  const created = ensureFirstAdmin();

  app.listen(PORT, HOST, () => {
    const sec = securitySnapshot();
    console.log('');
    console.log('  ✦ 小天才圈名平台 · 服务已启动');
    console.log(`  ➜ 本地访问:  http://localhost:${PORT}`);
    console.log(`  ➜ 邮箱发信:  ${isMailConfigured() ? '已配置，验证码将真实发送' : '未配置（请在后台「邮箱配置」中设置）'}`);
    console.log(`  ➜ 访问风控:  ${sec.config.enabled ? `开启（${sec.config.windowSeconds}s / ${sec.config.maxRequests} 次）` : '关闭'}`);
    if (created) {
      const line = '  ═══════════════════════════════════════════════════════';
      console.log('');
      console.log(line);
      console.log('  ✦ 首次启动：管理员账号已自动生成');
      if (created.__generated) {
        console.log('  ➜ 以下账号密码为随机生成，仅本次显示，请立即保存');
      } else {
        console.log('  ➜ 账号密码来自 .env 配置');
      }
      console.log(line);
      console.log(`  用户名    ${created.username}`);
      if (created.email) console.log(`  邮箱      ${created.email}`);
      console.log(`  密码      ${created.__plainPassword}`);
      console.log('  登录地址  /login');
      console.log(line);
      console.log('  请登录后立即在「个人中心 → 安全设置」修改密码。');
      console.log('  如需重新生成，删除 server/data/db.json 后重启服务。');
    }
    console.log('');
  });
}

bootstrap();
