/**
 * 邮箱服务商识别
 *
 * 单一数据源：后端校验与前端展示共用同一份映射，
 * 避免两端各写一份导致「后端认得、前端显示成『邮箱』」的不一致。
 *
 * 覆盖范围：
 * - 国内主流：QQ / 腾讯企业邮 / 网易 / 新浪 / 搜狐 / 阿里 / 华为 / 小米 / 189 / 139 / 21cn / 人民邮局
 * - 国际主流：Gmail / Outlook / Yahoo / iCloud / Proton / Zoho / GMX / Yandex / AOL / Fastmail
 * - 教育与企业：edu.cn 结尾、企业自有域名
 *
 * 另外支持**后缀族**匹配（如 edu.cn 涵盖所有高校邮箱）。
 */

/** 精确域名映射 */
export const EMAIL_DOMAINS: Record<string, string> = {
  /* ---------- 腾讯系 ---------- */
  'qq.com': 'QQ邮箱',
  'vip.qq.com': 'QQ邮箱',
  'foxmail.com': 'Foxmail',
  'tencent.com': '腾讯企业邮',

  /* ---------- 网易系 ---------- */
  '163.com': '网易邮箱',
  '126.com': '网易邮箱',
  'yeah.net': '网易邮箱',
  '188.com': '网易邮箱',
  'vip.163.com': '网易邮箱',
  'vip.126.com': '网易邮箱',
  'netease.com': '网易企业邮',

  /* ---------- 新浪 / 搜狐 ---------- */
  'sina.com': '新浪邮箱',
  'sina.cn': '新浪邮箱',
  'vip.sina.com': '新浪邮箱',
  'sohu.com': '搜狐邮箱',
  'vip.sohu.com': '搜狐邮箱',

  /* ---------- 阿里系 ---------- */
  'aliyun.com': '阿里邮箱',
  'alibaba.com': '阿里邮箱',
  'aliyun-inc.com': '阿里邮箱',
  'taobao.com': '阿里邮箱',

  /* ---------- 国内其他 ---------- */
  '139.com': '中国移动 139 邮箱',
  '189.cn': '中国电信 189 邮箱',
  'wo.cn': '中国联通沃邮箱',
  '21cn.com': '21CN 邮箱',
  'tom.com': 'TOM 邮箱',
  '263.net': '263 邮箱',
  'china.com': '中华网邮箱',
  'people.com.cn': '人民邮局',
  'peoplemail.com.cn': '人民邮局',
  'huawei.com': '华为邮箱',
  'xiaomi.com': '小米邮箱',
  'mi.com': '小米邮箱',
  'jd.com': '京东邮箱',
  'baidu.com': '百度邮箱',
  'bytedance.com': '字节跳动邮箱',
  'meituan.com': '美团邮箱',
  'bilibili.com': '哔哩哔哩邮箱',

  /* ---------- 国际主流 ---------- */
  'gmail.com': 'Gmail',
  'googlemail.com': 'Gmail',
  'outlook.com': 'Outlook',
  'outlook.com.cn': 'Outlook',
  'hotmail.com': 'Outlook',
  'hotmail.com.cn': 'Outlook',
  'live.com': 'Outlook',
  'live.cn': 'Outlook',
  'msn.com': 'Outlook',
  'windowslive.com': 'Outlook',
  'yahoo.com': 'Yahoo',
  'yahoo.com.cn': 'Yahoo',
  'yahoo.co.jp': 'Yahoo',
  'ymail.com': 'Yahoo',
  'icloud.com': 'iCloud',
  'me.com': 'iCloud',
  'mac.com': 'iCloud',
  'protonmail.com': 'ProtonMail',
  'proton.me': 'ProtonMail',
  'pm.me': 'ProtonMail',
  'zoho.com': 'Zoho',
  'zoho.com.cn': 'Zoho',
  'gmx.com': 'GMX',
  'gmx.net': 'GMX',
  'mail.com': 'Mail.com',
  'yandex.com': 'Yandex',
  'yandex.ru': 'Yandex',
  'aol.com': 'AOL',
  'fastmail.com': 'Fastmail',
  'tutanota.com': 'Tutanota',
  'tuta.io': 'Tutanota',
  'hushmail.com': 'Hushmail',
  'runbox.com': 'Runbox',
  'mail.ru': 'Mail.ru',
  'inbox.com': 'Inbox',
  'web.de': 'Web.de',
  't-online.de': 'T-Online',
  'orange.fr': 'Orange',
  'laposte.net': 'La Poste',
  'libero.it': 'Libero',
  'virgilio.it': 'Virgilio',
  'naver.com': 'Naver',
  'daum.net': 'Daum',
  'hanmail.net': 'Daum',
  'kakao.com': 'Kakao',
};

/** 后缀族匹配（按长度降序优先匹配） */
export const EMAIL_SUFFIXES: { suffix: string; label: string }[] = [
  { suffix: 'edu.cn', label: '教育邮箱' },
  { suffix: 'ac.cn', label: '科研邮箱' },
  { suffix: 'edu.hk', label: '教育邮箱' },
  { suffix: 'edu.tw', label: '教育邮箱' },
  { suffix: 'edu', label: '教育邮箱' },
  { suffix: 'ac.uk', label: '英国高校邮箱' },
  { suffix: 'edu.au', label: '澳洲高校邮箱' },
  { suffix: 'gov.cn', label: '政务邮箱' },
  { suffix: 'org.cn', label: '机构邮箱' },
  { suffix: 'com.cn', label: '企业邮箱' },
  { suffix: 'net.cn', label: '企业邮箱' },
  { suffix: 'co.jp', label: '日本企业邮箱' },
  { suffix: 'co.kr', label: '韩国企业邮箱' },
  { suffix: 'co.uk', label: '英国企业邮箱' },
];

/**
 * 解析邮箱域名对应的服务商名称
 * @param domain 已小写的域名
 */
export function resolveEmailProvider(domain: string): { label: string; common: boolean; kind: string } {
  const d = String(domain || '').toLowerCase();

  if (EMAIL_DOMAINS[d]) {
    return { label: EMAIL_DOMAINS[d], common: true, kind: 'known' };
  }

  // 后缀族：先长后短，避免 edu.cn 被 edu 抢先匹配
  const sorted = [...EMAIL_SUFFIXES].sort((a, b) => b.suffix.length - a.suffix.length);
  for (const item of sorted) {
    if (d === item.suffix || d.endsWith('.' + item.suffix)) {
      return { label: item.label, common: true, kind: 'suffix' };
    }
  }

  // 常见二级域名（如 company.com）仍视为企业邮箱，但不算「已知服务商」
  return { label: '企业/自定义邮箱', common: false, kind: 'custom' };
}
