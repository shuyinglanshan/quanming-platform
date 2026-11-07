import net from 'node:net';

/**
 * IP 归属地解析（离线，无外部依赖）
 *
 * 设计取舍：
 * - 生产环境若每次都调第三方 IP 库，会带来隐私泄露（把访客 IP 送给第三方）、
 *   额外延迟和限流风险，因此这里内置「常见网段 → 归属」的本地映射。
 * - 私有地址、回环、CGNAT 等特殊段单独标注，便于排查误封。
 * - 可扩展：如需精确到城市，可在 IPSegments 中追加，或接入本地 mmdb 库。
 */

/** 特殊用途网段 */
const SPECIAL = [
  { cidr: '127.0.0.0/8', label: '本机回环' },
  { cidr: '10.0.0.0/8', label: '内网地址' },
  { cidr: '172.16.0.0/12', label: '内网地址' },
  { cidr: '192.168.0.0/16', label: '内网地址' },
  { cidr: '169.254.0.0/16', label: '链路本地' },
  { cidr: '100.64.0.0/10', label: '运营商 NAT（CGNAT）' },
  { cidr: '0.0.0.0/8', label: '保留地址' },
  { cidr: '224.0.0.0/4', label: '组播地址' },
];

/**
 * 常见公网网段归属（粗粒度，用于运营判断）
 * 说明：只做省级/运营商级粗分，不追求精确到城市
 */
const SEGMENTS = [
  // 中国电信
  { cidr: '1.0.0.0/8', label: '中国 电信/联通' },
  { cidr: '14.0.0.0/8', label: '中国 电信' },
  { cidr: '27.0.0.0/8', label: '中国 电信' },
  { cidr: '36.0.0.0/8', label: '中国 电信' },
  { cidr: '39.0.0.0/8', label: '中国 电信' },
  { cidr: '42.0.0.0/8', label: '中国 电信' },
  { cidr: '58.0.0.0/8', label: '中国 电信' },
  { cidr: '59.0.0.0/8', label: '中国 电信' },
  { cidr: '61.0.0.0/8', label: '中国 电信' },
  { cidr: '106.0.0.0/8', label: '中国 电信' },
  { cidr: '113.0.0.0/8', label: '中国 电信' },
  { cidr: '117.0.0.0/8', label: '中国 电信' },
  { cidr: '119.0.0.0/8', label: '中国 电信' },
  { cidr: '121.0.0.0/8', label: '中国 电信' },
  { cidr: '122.0.0.0/8', label: '中国 电信' },
  { cidr: '124.0.0.0/8', label: '中国 电信' },
  { cidr: '125.0.0.0/8', label: '中国 电信' },
  // 中国联通
  { cidr: '60.0.0.0/8', label: '中国 联通' },
  { cidr: '101.0.0.0/8', label: '中国 联通' },
  { cidr: '110.0.0.0/8', label: '中国 联通' },
  { cidr: '112.0.0.0/8', label: '中国 联通' },
  { cidr: '116.0.0.0/8', label: '中国 联通' },
  { cidr: '120.0.0.0/8', label: '中国 联通' },
  { cidr: '123.0.0.0/8', label: '中国 联通' },
  { cidr: '175.0.0.0/8', label: '中国 联通' },
  { cidr: '218.0.0.0/8', label: '中国 联通' },
  { cidr: '219.0.0.0/8', label: '中国 联通' },
  { cidr: '220.0.0.0/8', label: '中国 联通' },
  { cidr: '221.0.0.0/8', label: '中国 联通' },
  // 中国移动
  { cidr: '111.0.0.0/8', label: '中国 移动' },
  { cidr: '183.0.0.0/8', label: '中国 移动' },
  { cidr: '211.0.0.0/8', label: '中国 移动' },
  { cidr: '117.128.0.0/10', label: '中国 移动' },
  { cidr: '120.192.0.0/10', label: '中国 移动' },
  // 教育网 / 其他
  { cidr: '202.112.0.0/13', label: '中国 教育网' },
  { cidr: '210.0.0.0/8', label: '亚太地区' },
  { cidr: '133.0.0.0/8', label: '日本' },
  { cidr: '150.0.0.0/8', label: '日本' },
  { cidr: '151.0.0.0/8', label: '欧洲' },
  { cidr: '192.0.0.0/8', label: '全球通用段' },
  { cidr: '198.0.0.0/8', label: '北美地区' },
  { cidr: '199.0.0.0/8', label: '北美地区' },
  { cidr: '203.0.0.0/8', label: '亚太地区' },
  { cidr: '8.0.0.0/8', label: '北美地区（Level3）' },
  { cidr: '13.0.0.0/8', label: 'Amazon AWS' },
  { cidr: '18.0.0.0/8', label: 'Amazon AWS' },
  { cidr: '34.0.0.0/8', label: 'Google Cloud' },
  { cidr: '35.0.0.0/8', label: 'Google Cloud' },
  { cidr: '45.0.0.0/8', label: '海外 VPS 常用段' },
  { cidr: '104.0.0.0/8', label: 'Cloudflare / 北美' },
  { cidr: '172.64.0.0/13', label: 'Cloudflare' },
  { cidr: '185.0.0.0/8', label: '欧洲 VPS 常用段' },
];

function ipToLong(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3];
}

function inCidr(ipLong, cidr) {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw ?? 32);
  const rangeLong = ipToLong(range);
  if (rangeLong === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipLong & mask) === (rangeLong & mask);
}

function normalize(ip) {
  let v = String(ip || '').trim();
  if (v.startsWith('::ffff:')) v = v.slice(7);
  if (v === '::1') v = '127.0.0.1';
  return v;
}

/**
 * 解析 IP 归属地
 * @returns {{ ip: string, region: string, kind: string, isPrivate: boolean, isIpv6: boolean }}
 */
export function lookupIp(rawIp) {
  const ip = normalize(rawIp);

  if (!ip || ip === '未知') {
    return { ip: ip || '未知', region: '未知', kind: 'unknown', isPrivate: false, isIpv6: false };
  }

  // IPv6
  if (net.isIPv6(ip)) {
    if (ip === '127.0.0.1' || ip.startsWith('fe80') || ip.startsWith('fc') || ip.startsWith('fd')) {
      return { ip, region: '内网 / 本地 IPv6', kind: 'private', isPrivate: true, isIpv6: true };
    }
    return { ip, region: 'IPv6 地址（未细分）', kind: 'ipv6', isPrivate: false, isIpv6: true };
  }

  if (!net.isIPv4(ip)) {
    return { ip, region: '非法 IP', kind: 'invalid', isPrivate: false, isIpv6: false };
  }

  const ipLong = ipToLong(ip);

  for (const item of SPECIAL) {
    if (inCidr(ipLong, item.cidr)) {
      return { ip, region: item.label, kind: 'private', isPrivate: true, isIpv6: false };
    }
  }
  for (const item of SEGMENTS) {
    if (inCidr(ipLong, item.cidr)) {
      return { ip, region: item.label, kind: 'public', isPrivate: false, isIpv6: false };
    }
  }
  return { ip, region: '公网地址（未收录网段）', kind: 'public', isPrivate: false, isIpv6: false };
}
