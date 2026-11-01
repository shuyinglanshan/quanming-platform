import net from 'node:net';

/**
 * 可信客户端 IP 解析
 *
 * 安全问题：直接读 X-Forwarded-For 会被客户端任意伪造，
 * 导致所有基于 IP 的限流（验证码签发、登录锁定、注册风控、永久封禁）全部失效。
 *
 * 策略：
 * - 默认不信任任何代理，使用 TCP 层的 socket 地址
 * - 仅当显式配置 TRUST_PROXY=1|true 时，才从 XFF 右侧按可信任代理层数取值
 * - 可选 IP_CIDR 白名单，只有来自这些网段的直连才允许解析 XFF
 */

const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ''));
const PROXY_HOPS = Math.max(1, Number(process.env.TRUST_PROXY_HOPS) || 1);

/** 可信任的反向代理网段（逗号分隔 CIDR） */
const TRUSTED_CIDRS = String(process.env.TRUSTED_PROXIES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function ipToLong(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr(ip, cidr) {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw ?? 32);
  if (!net.isIPv4(ip) || !net.isIPv4(range)) return false;
  const ipLong = ipToLong(ip);
  const rangeLong = ipToLong(range);
  if (ipLong === null || rangeLong === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipLong & mask) === (rangeLong & mask);
}

function normalize(ip) {
  if (!ip) return '';
  let value = String(ip).trim();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  // IPv6 回环统一成 IPv4 便于白名单匹配
  if (value === '::1') value = '127.0.0.1';
  return value;
}

/** 建立连接的真实对端地址 */
export function socketIp(req) {
  return normalize(req.socket?.remoteAddress || req.connection?.remoteAddress || '');
}

/** 是否来自可信任代理 */
function fromTrustedProxy(req) {
  if (!TRUST_PROXY) return false;
  if (TRUSTED_CIDRS.length === 0) return true; // 配置了 TRUST_PROXY 但未限定网段
  const peer = socketIp(req);
  return TRUSTED_CIDRS.some((cidr) => inCidr(peer, cidr));
}

/**
 * 获取可信客户端 IP
 * 从 XFF 右侧数 PROXY_HOPS 个（右侧是最近一跳，最可信）
 */
export function trustedClientIp(req) {
  const peer = socketIp(req);

  if (!fromTrustedProxy(req)) {
    // 不信任代理时，一律以 TCP 连接地址为准，忽略所有伪造头
    return peer || '未知';
  }

  // 仅在信任代理时解析 XFF：格式 client, proxy1, proxy2 ...
  const xff = String(req.get('x-forwarded-for') || '')
    .split(',')
    .map((s) => normalize(s))
    .filter(Boolean);

  if (xff.length === 0) return peer || '未知';

  // 取倒数第 PROXY_HOPS 个（跳过我们自己信任的代理层）
  const idx = Math.max(0, xff.length - PROXY_HOPS);
  return xff[idx] || peer || '未知';
}

export const ipConfig = () => ({
  trustProxy: TRUST_PROXY,
  hops: PROXY_HOPS,
  trustedCidrs: TRUSTED_CIDRS,
});
