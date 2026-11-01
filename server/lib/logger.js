import crypto from 'node:crypto';
import { db, save } from './db.js';

/**
 * 日志批量落盘调度
 * 访问日志属于高频写入，若每条都触发全量 JSON 落盘会阻塞事件循环
 * （实测 db 287KB 时并发 p99 从 9ms 恶化到 839ms）。
 * 这里改为内存累积 + 定时批量刷盘。
 */
let logFlushTimer = null;
let pendingLogs = 0;

function scheduleLogFlush() {
  pendingLogs += 1;
  // 达到批量阈值立即落盘，避免内存无界增长
  if (pendingLogs >= 200) {
    pendingLogs = 0;
    if (logFlushTimer) {
      clearTimeout(logFlushTimer);
      logFlushTimer = null;
    }
    save();
    return;
  }
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(() => {
    logFlushTimer = null;
    pendingLogs = 0;
    save();
  }, 1000);
  if (typeof logFlushTimer.unref === 'function') logFlushTimer.unref();
}
import { clientIp, parseUA } from './util.js';

const MAX_LOGS = 2000;

/**
 * 日志完整性哈希链
 * 每条日志都包含「上一条日志的哈希」，形成链式结构。
 * 若有人删改中间某条日志，后续哈希校验会失败，可用于取证与审计。
 */
let lastHash = 'genesis';

function chainHash(entry) {
  const payload = JSON.stringify({
    ts: entry.ts,
    ip: entry.ip,
    method: entry.method,
    path: entry.path,
    status: entry.status,
    action: entry.action,
    prev: lastHash,
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

/** 校验日志链完整性，返回 { ok, brokenAt } */
export function verifyLogChain() {
  let prev = 'genesis';
  // 日志按时间倒序存储，从最旧到最新校验
  const ordered = [...db.logs].reverse();
  for (const entry of ordered) {
    if (entry.chain && entry.prev !== prev) {
      return { ok: false, brokenAt: entry.id, ts: entry.ts };
    }
    prev = entry.chain || prev;
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
export function accessLog(req, res, startedAt) {
  const path = req.originalUrl.split('?')[0];
  if (path.startsWith('/uploads') || path.startsWith('/assets')) return;
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
  };
  entry.prev = lastHash;
  entry.chain = chainHash(entry);
  lastHash = entry.chain;
  db.logs.unshift(entry);
  if (db.logs.length > MAX_LOGS) db.logs.length = MAX_LOGS;
  scheduleLogFlush();
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
  };
  entry.prev = lastHash;
  entry.chain = chainHash(entry);
  lastHash = entry.chain;
  db.logs.unshift(entry);
  if (db.logs.length > MAX_LOGS) db.logs.length = MAX_LOGS;
  scheduleLogFlush();
}
