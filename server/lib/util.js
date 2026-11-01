import { trustedClientIp } from './ip.js';

/** 通用工具函数 */

/**
 * 注册 / 登录统一使用「QQ号@qq.com」
 * 返回 { qq, email } 或 null
 */
export function parseQQNumberEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  const matched = /^(\d{5,11})@qq\.com$/.exec(value);
  if (!matched) return null;
  return { qq: matched[1], email: `${matched[1]}@qq.com` };
}

/** 圈名规则：2-16 个字符，中英文数字与常见符号 */
export function validateName(name) {
  const value = String(name || '').trim();
  if (!value) return '请填写圈名';
  if ([...value].length < 2) return '圈名至少需要 2 个字符';
  if ([...value].length > 16) return '圈名最多 16 个字符';
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_\-·.。\s]+$/.test(value)) return '圈名仅支持中英文、数字与 _ - · . 等符号';
  return null;
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8) return '密码至少 8 位';
  if (value.length > 64) return '密码最多 64 位';
  if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) return '密码需同时包含字母与数字';
  return null;
}

export function validateNickname(nickname) {
  const value = String(nickname || '').trim();
  if ([...value].length < 2) return '昵称至少 2 个字符';
  if ([...value].length > 16) return '昵称最多 16 个字符';
  return null;
}

/** 中国大陆手机号 */
export function normalizePhone(phone) {
  return String(phone || '').replace(/[\s-]/g, '').trim();
}

export function validatePhone(phone) {
  const value = normalizePhone(phone);
  if (!value) return '请填写手机号';
  if (!/^1\d{10}$/.test(value)) return '手机号格式不正确（需 11 位数字）';
  if (!/^1[3-9]\d{9}$/.test(value)) return '请填写有效的中国大陆手机号';
  return null;
}

/** 用户名：4-20 位，字母开头，允许字母数字下划线 */
export function validateUsername(username) {
  const value = String(username || '').trim();
  if (!value) return '请填写用户名';
  if (!/^[a-zA-Z][a-zA-Z0-9_]{3,19}$/.test(value)) {
    return '用户名需 4-20 位，以字母开头，仅支持字母、数字与下划线';
  }
  return null;
}

export function escapeHtml(input) {
  return String(input ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 客户端 IP（用于日志展示）
 * 注意：安全判定请使用 trustedClientIp，避免 XFF 伪造
 */
export function clientIp(req) {
  try {
    // 延迟引入避免循环依赖
    return trustedClientIp(req);
  } catch {
    return (req.socket?.remoteAddress || '').replace('::ffff:', '') || '未知';
  }
}

export function parseUA(ua = '') {
  const s = String(ua);
  let browser = '其他';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Chrome\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';
  else if (/curl|node|axios|okhttp/i.test(s)) browser = '程序请求';

  let os = '其他';
  if (/Windows NT/.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';

  let device = '桌面端';
  if (/Mobile|Android|iPhone/.test(s)) device = '移动端';
  if (/iPad|Tablet/.test(s)) device = '平板';
  return { browser, os, device };
}

export function timeBucket(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function paginate(list, page = 1, pageSize = 12) {
  const total = list.length;
  const size = Math.min(Math.max(Number(pageSize) || 12, 1), 100);
  const current = Math.max(Number(page) || 1, 1);
  const pages = Math.max(Math.ceil(total / size), 1);
  const start = (current - 1) * size;
  return {
    items: list.slice(start, start + size),
    total,
    page: current,
    pageSize: size,
    pages,
  };
}

export function randomCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i += 1) out += Math.floor(Math.random() * 10);
  return out;
}

/**
 * 纯文本清洗，用于昵称、圈名、简介等字段
 * 策略：整段移除 script/style 等危险元素（含内容），再剥离其余标签，
 * 保留标签内的普通文字，避免「<b>x</b>」被清成空串这类误伤。
 */
export function sanitizeText(input, maxLen = 200) {
  let value = String(input ?? '');
  // 控制字符
  value = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  // HTML 注释
  value = value.replace(/<!--[\s\S]*?-->/g, '');
  // 危险元素：标签与内部文本一并移除
  value = value.replace(/<(script|style|iframe|object|embed|svg|math|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  value = value.replace(/<(script|style|iframe|object|embed|svg|math|template)\b[^>]*\/?>/gi, '');
  // 其余标签只去标签保留文字
  value = value.replace(/<[^>]*>/g, '');
  // 残留协议与事件属性
  value = value.replace(/javascript\s*:/gi, '');
  value = value.replace(/on[a-z]+\s*=/gi, '');
  // 多余的尖括号
  value = value.replace(/[<>]/g, '');
  value = value.replace(/\s+/g, ' ').trim();
  return value.slice(0, maxLen);
}

