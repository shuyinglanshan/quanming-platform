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

/**
 * 城市级网段（在 SEGMENTS 之后匹配，更精确）
 * 说明：离线表只能覆盖常见段，未命中时回退到省级/运营商级。
 * 如需精确到区县，建议接入本地 mmdb（如 GeoLite2-City）并通过 IP_CITY_DB 指定路径。
 */
const CITY_SEGMENTS = [
  // 广东
  { cidr: '113.65.0.0/16', label: '中国 广东 广州 电信' },
  { cidr: '113.66.0.0/16', label: '中国 广东 广州 电信' },
  { cidr: '113.67.0.0/16', label: '中国 广东 广州 电信' },
  { cidr: '113.68.0.0/16', label: '中国 广东 广州 电信' },
  { cidr: '113.109.0.0/16', label: '中国 广东 广州 电信' },
  { cidr: '116.21.0.0/16', label: '中国 广东 广州 电信' },
  { cidr: '116.22.0.0/16', label: '中国 广东 广州 电信' },
  { cidr: '119.129.0.0/16', label: '中国 广东 广州 电信' },
  { cidr: '120.236.0.0/16', label: '中国 广东 广州 移动' },
  { cidr: '183.6.0.0/16', label: '中国 广东 广州 移动' },
  { cidr: '183.63.0.0/16', label: '中国 广东 广州 移动' },
  { cidr: '113.87.0.0/16', label: '中国 广东 深圳 电信' },
  { cidr: '113.88.0.0/16', label: '中国 广东 深圳 电信' },
  { cidr: '113.89.0.0/16', label: '中国 广东 深圳 电信' },
  { cidr: '113.116.0.0/16', label: '中国 广东 深圳 电信' },
  { cidr: '116.24.0.0/16', label: '中国 广东 深圳 电信' },
  { cidr: '119.137.0.0/16', label: '中国 广东 深圳 电信' },
  { cidr: '183.14.0.0/16', label: '中国 广东 深圳 移动' },
  { cidr: '183.17.0.0/16', label: '中国 广东 深圳 移动' },
  { cidr: '14.215.0.0/16', label: '中国 广东 深圳 电信' },
  { cidr: '113.95.0.0/16', label: '中国 广东 东莞 电信' },
  { cidr: '113.96.0.0/16', label: '中国 广东 东莞 电信' },
  { cidr: '183.22.0.0/16', label: '中国 广东 东莞 移动' },
  { cidr: '113.70.0.0/16', label: '中国 广东 佛山 电信' },
  { cidr: '113.71.0.0/16', label: '中国 广东 佛山 电信' },
  // 北京
  { cidr: '123.112.0.0/14', label: '中国 北京 联通' },
  { cidr: '123.116.0.0/14', label: '中国 北京 联通' },
  { cidr: '114.242.0.0/15', label: '中国 北京 联通' },
  { cidr: '111.192.0.0/12', label: '中国 北京 移动' },
  { cidr: '117.136.0.0/13', label: '中国 北京 移动' },
  { cidr: '39.144.0.0/16', label: '中国 北京 移动' },
  { cidr: '106.11.0.0/16', label: '中国 北京 阿里云' },
  { cidr: '47.92.0.0/16', label: '中国 北京 阿里云' },
  { cidr: '47.94.0.0/16', label: '中国 北京 阿里云' },
  // 上海
  { cidr: '101.80.0.0/12', label: '中国 上海 电信' },
  { cidr: '114.80.0.0/12', label: '中国 上海 电信' },
  { cidr: '116.226.0.0/15', label: '中国 上海 电信' },
  { cidr: '180.163.0.0/16', label: '中国 上海 电信' },
  { cidr: '39.156.0.0/16', label: '中国 上海 移动' },
  { cidr: '106.14.0.0/16', label: '中国 上海 阿里云' },
  { cidr: '47.100.0.0/16', label: '中国 上海 阿里云' },
  { cidr: '47.101.0.0/16', label: '中国 上海 阿里云' },
  // 浙江
  { cidr: '115.192.0.0/12', label: '中国 浙江 杭州 电信' },
  { cidr: '122.224.0.0/12', label: '中国 浙江 杭州 电信' },
  { cidr: '183.129.0.0/16', label: '中国 浙江 杭州 移动' },
  { cidr: '36.16.0.0/13', label: '中国 浙江 杭州 移动' },
  { cidr: '47.96.0.0/16', label: '中国 浙江 杭州 阿里云' },
  { cidr: '47.98.0.0/16', label: '中国 浙江 杭州 阿里云' },
  { cidr: '115.206.0.0/16', label: '中国 浙江 宁波 电信' },
  // 江苏
  { cidr: '49.64.0.0/12', label: '中国 江苏 南京 电信' },
  { cidr: '58.212.0.0/16', label: '中国 江苏 南京 电信' },
  { cidr: '180.97.0.0/16', label: '中国 江苏 南京 电信' },
  { cidr: '218.2.0.0/16', label: '中国 江苏 南京 电信' },
  { cidr: '121.224.0.0/12', label: '中国 江苏 苏州 电信' },
  { cidr: '47.102.0.0/16', label: '中国 江苏 苏州 阿里云' },
  // 四川
  { cidr: '110.184.0.0/13', label: '中国 四川 成都 电信' },
  { cidr: '118.112.0.0/13', label: '中国 四川 成都 电信' },
  { cidr: '171.208.0.0/13', label: '中国 四川 成都 电信' },
  { cidr: '125.69.0.0/16', label: '中国 四川 成都 电信' },
  // 湖北
  { cidr: '111.172.0.0/14', label: '中国 湖北 武汉 电信' },
  { cidr: '119.96.0.0/13', label: '中国 湖北 武汉 电信' },
  { cidr: '27.16.0.0/12', label: '中国 湖北 武汉 电信' },
  // 湖南
  { cidr: '110.52.0.0/14', label: '中国 湖南 长沙 电信' },
  { cidr: '222.240.0.0/13', label: '中国 湖南 长沙 电信' },
  // 河南
  { cidr: '123.4.0.0/14', label: '中国 河南 郑州 联通' },
  { cidr: '171.8.0.0/13', label: '中国 河南 郑州 电信' },
  // 山东
  { cidr: '112.224.0.0/12', label: '中国 山东 济南 电信' },
  { cidr: '119.162.0.0/16', label: '中国 山东 济南 联通' },
  { cidr: '58.56.0.0/15', label: '中国 山东 青岛 电信' },
  { cidr: '112.255.0.0/16', label: '中国 山东 青岛 电信' },
  // 福建
  { cidr: '110.80.0.0/13', label: '中国 福建 福州 电信' },
  { cidr: '117.24.0.0/13', label: '中国 福建 泉州 电信' },
  { cidr: '120.36.0.0/14', label: '中国 福建 厦门 移动' },
  { cidr: '117.28.0.0/16', label: '中国 福建 厦门 电信' },
  // 陕西
  { cidr: '113.132.0.0/14', label: '中国 陕西 西安 电信' },
  { cidr: '117.22.0.0/15', label: '中国 陕西 西安 电信' },
  // 重庆
  { cidr: '113.204.0.0/14', label: '中国 重庆 电信' },
  { cidr: '183.64.0.0/13', label: '中国 重庆 移动' },
  // 天津
  { cidr: '111.160.0.0/13', label: '中国 天津 联通' },
  { cidr: '221.196.0.0/14', label: '中国 天津 联通' },
  // 辽宁
  { cidr: '113.224.0.0/12', label: '中国 辽宁 沈阳 联通' },
  { cidr: '119.112.0.0/13', label: '中国 辽宁 大连 联通' },
  // 安徽
  { cidr: '114.96.0.0/12', label: '中国 安徽 合肥 电信' },
  { cidr: '183.160.0.0/13', label: '中国 安徽 合肥 移动' },
  // 江西
  { cidr: '111.72.0.0/13', label: '中国 江西 南昌 移动' },
  // 广西
  { cidr: '113.12.0.0/14', label: '中国 广西 南宁 电信' },
  // 云南
  { cidr: '116.52.0.0/14', label: '中国 云南 昆明 电信' },
  // 贵州
  { cidr: '58.16.0.0/16', label: '中国 贵州 贵阳 电信' },
  // 河北
  { cidr: '110.228.0.0/14', label: '中国 河北 石家庄 电信' },
  // 山西
  { cidr: '110.176.0.0/13', label: '中国 山西 太原 电信' },
  // 黑龙江 / 吉林
  { cidr: '113.0.0.0/14', label: '中国 黑龙江 哈尔滨 联通' },
  { cidr: '122.136.0.0/13', label: '中国 吉林 长春 联通' },
  // 内蒙 / 新疆 / 甘肃 / 宁夏 / 青海 / 海南 / 西藏
  { cidr: '110.16.0.0/14', label: '中国 内蒙古 呼和浩特 联通' },
  { cidr: '110.152.0.0/14', label: '中国 新疆 乌鲁木齐 电信' },
  { cidr: '60.164.0.0/15', label: '中国 甘肃 兰州 联通' },
  { cidr: '222.75.0.0/16', label: '中国 宁夏 银川 电信' },
  { cidr: '223.220.0.0/16', label: '中国 青海 西宁 电信' },
  { cidr: '220.174.0.0/16', label: '中国 海南 海口 电信' },
  { cidr: '113.62.0.0/16', label: '中国 西藏 拉萨 电信' },
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
  // 城市级优先（更精确）；未命中再回退到省级/运营商级
  for (const item of CITY_SEGMENTS) {
    if (inCidr(ipLong, item.cidr)) {
      return { ip, region: item.label, kind: 'public', isPrivate: false, isIpv6: false, withCity: true };
    }
  }
  for (const item of SEGMENTS) {
    if (inCidr(ipLong, item.cidr)) {
      return { ip, region: item.label, kind: 'public', isPrivate: false, isIpv6: false };
    }
  }
  return { ip, region: '公网地址（未收录网段）', kind: 'public', isPrivate: false, isIpv6: false };
}
