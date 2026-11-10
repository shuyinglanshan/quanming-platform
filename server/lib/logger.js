import crypto from 'node:crypto';
import { db } from './db.js';
import { saveLog, pruneLogs } from './repo.js';
import { clientIp, parseUA } from './util.js';

const MAX_LOGS = 3000;
let logWrites = 0;

/**
 * 每条日志立即落库（写穿，不做延迟批量缓存）。
 * 每写入 200 条清理一次历史记录，数据库与内存保持同样的最新 2000 条。
 */
function persistLog(entry) {
  try {
    saveLog(entry);
    logWrites += 1;
    if (logWrites % 200 === 0) pruneLogs(MAX_LOGS);
  } catch (err) {
    console.error('[logger] 日志落库失败:', err.message);
  }
}

/**
 * 日志完整性哈希链
 * 每条日志都包含「上一条日志的哈希」，形成链式结构。
 * 若有人删改中间某条日志，后续哈希校验会失败，可用于取证与审计。
 * 进程重启时从数据库最新一条日志继续衔接，避免出现断链。
 */
let lastHash = db.logs[0]?.chain || 'genesis';

function chainHash(entry, prevHash) {
  const payload = JSON.stringify({
    ts: entry.ts,
    ip: entry.ip,
    method: entry.method,
    path: entry.path,
    status: entry.status,
    action: entry.action,
    // v2 起 detail/email/ua 同样纳入哈希，避免只改审计详情而不破坏链
    detail: entry.detail || '',
    email: entry.email || '',
    level: entry.level || 'info',
    ua: entry.ua || '',
    prev: prevHash,
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

/** 校验日志链完整性，返回 { ok, brokenAt } */
export function verifyLogChain() {
  // 日志按时间倒序存储，从最旧到最新校验
  const ordered = [...db.logs].reverse();
  if (!ordered.length) return { ok: true, total: 0 };

  // 最旧一条的 prev 可能指向已被裁剪的历史日志，无法回溯，只校验其后的链接
  let prev = ordered[0].chain || ordered[0].prev || 'genesis';
  if (ordered[0].v === 2 && chainHash(ordered[0], ordered[0].prev) !== ordered[0].chain) {
    return { ok: false, brokenAt: ordered[0].id, ts: ordered[0].ts };
  }
  for (let i = 1; i < ordered.length; i += 1) {
    const entry = ordered[i];
    if (!entry.chain) continue; // 历史无哈希数据，跳过不阻断
    if (entry.prev !== prev) {
      return { ok: false, brokenAt: entry.id, ts: entry.ts };
    }
    // v2 日志重算整条哈希，可发现 detail/email/ua 等字段被篡改；旧日志仅校验链接
    if (entry.v === 2 && chainHash(entry, entry.prev) !== entry.chain) {
      return { ok: false, brokenAt: entry.id, ts: entry.ts };
    }
    prev = entry.chain;
  }
  return { ok: true, total: ordered.length };
}

const SENSITIVE = [/\/api\/auth\/.*/];

function describe(req) {
  const path = req.originalUrl.split('?')[0];
  const method = req.method;
  const map = [
    [/^\/api\/health$/, '健康检查'],
    [/^\/api\/auth\/email-check$/, '邮箱后缀识别'],
    [/^\/api\/auth\/send-code$/, '发送邮箱验证码'],
    [/^\/api\/auth\/register$/, '注册账号'],
    [/^\/api\/auth\/login$/, '登录账号'],
    [/^\/api\/auth\/login-code$/, '验证码登录'],
    [/^\/api\/auth\/logout$/, '退出登录'],
    [/^\/api\/auth\/me$/, '获取登录状态'],
    [/^\/api\/auth\/change-password$/, '修改登录密码'],
    [/^\/api\/claims\/upload$/, '上传归属证明材料'],
    [/^\/api\/claims\/mine$/, '查看我的申请'],
    [/^\/api\/claims$/, method === 'POST' ? '提交圈名归属申请' : '查看我的申请'],
    [/^\/api\/claims\/[^/]+$/, '撤回归属申请'],
    [/^\/api\/appeals\/mine$/, '查看我的申诉'],
    [/^\/api\/appeals$/, method === 'POST' ? '提交圈名归属申诉' : '查看我的申诉'],
    [/^\/api\/appeals\/[^/]+$/, '撤回圈名归属申诉'],
    [/^\/api\/notifications\/read$/, '标记通知已读'],
    [/^\/api\/notifications/, '查看通知'],
    [/^\/api\/admin\/stats$/, '查看后台统计'],
    [/^\/api\/admin\/claims\/batch$/, '批量处理归属申请'],
    [/^\/api\/admin\/claims\/[^/]+\/approve$/, '审核通过圈名归属'],
    [/^\/api\/admin\/claims\/[^/]+\/reject$/, '驳回圈名归属'],
    [/^\/api\/admin\/claims/, '查看归属申请'],
    [/^\/api\/admin\/appeals\/[^/]+\/approve$/, '申诉通过并转移归属'],
    [/^\/api\/admin\/appeals\/[^/]+\/reject$/, '驳回圈名归属申诉'],
    [/^\/api\/admin\/appeals/, '查看归属申诉'],
    [/^\/api\/admin\/users\/roles$/, '批量调整权限组'],
    [/^\/api\/admin\/users/, '管理用户与权限组'],
    [/^\/api\/admin\/names/, '管理圈名'],
    [/^\/api\/admin\/logs/, '查看访问日志'],
    [/^\/api\/admin\/mail\/test$/, '发送测试邮件'],
    [/^\/api\/admin\/mail\/verify$/, '校验 SMTP 连接'],
    [/^\/api\/admin\/mail/, '邮箱配置'],
    [/^\/api\/admin\/notifications\/broadcast$/, '发布系统通知'],
    [/^\/api\/admin\/notifications\/send$/, '发送指定用户通知'],
    [/^\/api\/admin\/notifications/, '通知管理'],
    [/^\/api\/admin\/security\/block$/, '限制 IP 访问'],
    [/^\/api\/admin\/security\/unblock$/, '解除 IP 限制'],
    [/^\/api\/admin\/security/, '访问风控设置'],
    [/^\/api\/admin\/system/, '查看系统信息'],
    [/^\/api\/names\/suggest$/, '圈名联想'],
    [/^\/api\/names\/search-log$/, '记录搜索行为'],
    [/^\/api\/names\/stats\/overview$/, '查看公开统计'],
    [/^\/api\/names/, '检索圈名'],
    [/^\/api\/me\/profile$/, '个人资料操作'],
    [/^\/api\/me\/bindings/, '社交账号绑定'],
    [/^\/api\/me\/password$/, '修改登录密码'],
    [/^\/api\/me/, '个人中心'],
  ];
  for (const [re, label] of map) if (re.test(path)) return label;
  return '接口访问';
}

/** 记录一条访问日志（敏感接口不记录请求体） */
/**
 * 高频只读接口：不写访问日志
 *
 * 问题：/api/auth/me 在每次页面加载、每次会话刷新都会被调用，
 * 实测 24 小时内 3206 条日志里有 1139 条是它（35%）。
 * 大量噪音会淹没真实的攻击记录，也让链式哈希存储快速膨胀。
 *
 * 处理：
 *   · 成功响应（2xx/3xx）不记录
 *   · 失败响应（4xx/5xx）仍然记录 —— 失败的 /auth/me 往往是
 *     会话异常或探测行为，有审计价值
 */
const NOISY_PATHS = new Set([
  '/api/auth/me',
  '/api/health',
  '/api/notifications/unread-count',
  '/api/crypto/pubkey',
  '/api/me/heartbeat',
]);

export function accessLog(req, res, startedAt) {
  const path = req.originalUrl.split('?')[0];
  if (path.startsWith('/uploads') || path.startsWith('/assets')) return;
  // 高频只读接口成功时不记录，失败时保留（便于发现异常）
  if (NOISY_PATHS.has(path) && res.statusCode < 400) return;
  const ua = parseUA(req.get('user-agent'));
  const entry = {
    id: 'log_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: Date.now(),
    ip: clientIp(req),
    method: req.method,
    path: req.originalUrl.length > 240 ? req.originalUrl.slice(0, 240) : req.originalUrl,
    status: res.statusCode,
    ms: Date.now() - startedAt,
    action: describe(req),
    userId: req.user?.id || null,
    email: req.user?.email || null,
    ua: req.get('user-agent')?.slice(0, 220) || '',
    ...ua,
    v: 2,
  };
  entry.prev = lastHash;
  entry.chain = chainHash(entry, entry.prev);
  lastHash = entry.chain;
  db.logs.unshift(entry);
  if (db.logs.length > MAX_LOGS) db.logs.length = MAX_LOGS;
  persistLog(entry);
}

export function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', () => accessLog(req, res, startedAt));
  next();
}

/** 记录一条业务日志（登录失败、审核动作等） */
export function eventLog(req, action, detail = '', level = 'info') {
  const ua = parseUA(req.get('user-agent'));
  // 未登录场景（注册 / 登录）从 detail 中提取邮箱，便于后台定位到具体账号
  const emailMatch = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(detail || '');
  const entry = {
    id: 'log_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: Date.now(),
    ip: clientIp(req),
    method: req.method,
    path: req.originalUrl.split('?')[0],
    status: level === 'error' ? 400 : 200,
    ms: 0,
    action,
    detail,
    level,
    userId: req.user?.id || null,
    email: req.user?.email || emailMatch?.[0] || null,
    ua: req.get('user-agent')?.slice(0, 220) || '',
    ...ua,
    v: 2,
  };
  entry.prev = lastHash;
  entry.chain = chainHash(entry, entry.prev);
  lastHash = entry.chain;
  db.logs.unshift(entry);
  if (db.logs.length > MAX_LOGS) db.logs.length = MAX_LOGS;
  persistLog(entry);
}
