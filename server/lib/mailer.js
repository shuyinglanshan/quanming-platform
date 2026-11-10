import nodemailer from 'nodemailer';
import { db, save } from './db.js';
import { escapeHtml } from './util.js';

/**
 * 邮件发送模块（真实 SMTP 发送）
 * 配置优先级：数据库 settings.mail（后台可视化配置） > 环境变量 .env
 * 未配置账号或授权码时不做任何模拟发送，直接返回错误，由调用方提示用户。
 */

const envFallback = {
  host: process.env.SMTP_HOST || 'smtp.qq.com',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: Number(process.env.SMTP_PORT || 465) === 465,
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  fromName: process.env.MAIL_FROM_NAME || '小天才圈名平台',
  fromEmail: process.env.SMTP_FROM || process.env.SMTP_USER || '',
};

export const DEFAULT_TEMPLATE = `<!doctype html>
<html lang="zh-CN"><body style="margin:0;padding:32px 16px;background:#07070d;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:520px;margin:0 auto;border-radius:20px;overflow:hidden;background:linear-gradient(160deg,rgba(124,92,255,.22),rgba(34,211,238,.12));border:1px solid rgba(255,255,255,.12);">
    <div style="padding:28px 30px;color:#e9e9f5;">
      <div style="font-size:12px;letter-spacing:3px;color:#a9a4ff;">小天才圈名平台</div>
      <h1 style="margin:10px 0 18px;font-size:22px;font-weight:600;">验证码 · {{action}}</h1>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#b9b8cc;">你好，你正在{{action}}，请在 10 分钟内输入以下验证码完成验证。若非本人操作，请忽略本邮件。</p>
      <div style="margin:24px 0;padding:20px;text-align:center;border-radius:14px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.1);">
        <div style="font-size:34px;letter-spacing:12px;font-weight:700;color:#ffffff;">{{code}}</div>
      </div>
      <p style="margin:0;font-size:12px;color:#7f7e93;">验证码 10 分钟内有效，请勿转发给他人。</p>
    </div>
    <div style="padding:14px 30px;background:rgba(0,0,0,.35);font-size:12px;color:#6f6e85;">© {{year}} 小天才圈名平台 · 开发者 疏影阑珊</div>
  </div>
</body></html>`;

/** 读取当前生效的邮件配置（含来源标记）
 *  凭据（账号/授权码/服务器）优先取后台配置，其次 .env；
 *  主题、模板、发件人名称始终以后台配置为准。
 */
export function getMailConfig() {
  const saved = db.settings?.mail || {};
  const useSaved = Boolean(saved.user && saved.pass);
  const base = useSaved ? saved : envFallback;
  const conf = {
    host: base.host || 'smtp.qq.com',
    port: Number(base.port) || 465,
    secure: base.secure !== false,
    user: base.user || '',
    pass: base.pass || '',
    fromName: saved.fromName || envFallback.fromName || '小天才圈名平台',
    fromEmail: base.fromEmail || base.user || '',
    subject: saved.subject || '【小天才圈名平台】{{action}}验证码 {{code}}',
    template: saved.template || DEFAULT_TEMPLATE,
  };
  const configured = Boolean(conf.user && conf.pass);
  return { ...conf, configured, source: useSaved ? 'admin' : configured ? 'env' : 'none' };
}

/** 对外暴露的脱敏配置（给后台展示） */
export function publicMailConfig() {
  const conf = getMailConfig();
  return {
    host: conf.host,
    port: conf.port,
    secure: conf.secure,
    user: conf.user,
    passSet: Boolean(conf.pass),
    passMasked: conf.pass ? '••••••••' + conf.pass.slice(-4) : '',
    fromName: conf.fromName,
    fromEmail: conf.fromEmail,
    subject: conf.subject,
    template: conf.template,
    configured: conf.configured,
    source: conf.source,
  };
}

let cache = { key: '', transporter: null };

function transporterFor(conf) {
  const key = `${conf.host}|${conf.port}|${conf.user}|${conf.pass}`;
  if (cache.key === key && cache.transporter) return cache.transporter;
  const transporter = nodemailer.createTransport({
    host: conf.host,
    port: conf.port,
    secure: conf.secure,
    auth: { user: conf.user, pass: conf.pass },
    pool: true,
    maxConnections: 2,
    connectionTimeout: 12000,
    /**
     * 安全修正（防信息泄露）：
     *   默认 nodemailer 会在邮件头写入 X-Mailer、Message-ID（含本地主机名/出口 IP），
     *   以及发信账号的原始地址。攻击者可从邮件源查到运营方真实邮箱与服务器信息。
     *
     *   这里关闭客户端标识注入，并设置通用 name。
     */
    name: 'localhost.localdomain',
    // 不发送 X-Mailer
    xMailer: false,
  });
  cache = { key, transporter };
  return transporter;
}

export function invalidateMailerCache() {
  cache = { key: '', transporter: null };
}

/** 模板变量替换 */
export function renderTemplate(tpl, vars) {
  return String(tpl || DEFAULT_TEMPLATE).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) =>
    vars[key] !== undefined ? escapeHtml(vars[key]) : m,
  );
}

export function previewMail({ code = '123456', action = '注册账号' } = {}) {
  const conf = getMailConfig();
  const vars = { code, action, year: new Date().getFullYear(), site: '小天才圈名平台' };
  return {
    subject: renderTemplate(conf.subject, vars).replace(/&amp;/g, '&'),
    html: renderTemplate(conf.template, vars),
  };
}

/** 发送验证码邮件：未配置时直接抛错，不做任何模拟 */
export async function sendCodeMail(email, code, purpose = 'register') {
  const conf = getMailConfig();
  if (!conf.configured) {
    const err = new Error('平台尚未配置 QQ 邮箱发信账号，请联系管理员在后台完成邮箱配置');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }
  const action = purpose === 'register' ? '注册账号' : '登录账号';
  const vars = { code, action, year: new Date().getFullYear(), site: '小天才圈名平台' };
  const subject = renderTemplate(conf.subject, vars).replace(/&amp;/g, '&');
  const html = renderTemplate(conf.template, vars);

  await transporterFor(conf).sendMail({
    from: `"${conf.fromName}" <${conf.fromEmail || conf.user}>`,
    to: email,
    subject,
    html,
    text: `你的${action}验证码是 ${code}，10 分钟内有效。`,
    /**
     * 安全修正（防信息泄露）：
     *   · 移除 X-Mailer（默认会暴露 nodemailer 版本）
     *   · 移除 X-Priority / X-MSMail-Priority 等客户端指纹
     *   · Message-ID 由 nodemailer 生成时会把本地主机名写入域名部分，
     *     这里显式指定一个中性域名
     *   · 不设置 Reply-To（否则会暴露运营方真实邮箱）
     */
    headers: {
      'X-Mailer': '',
      'X-Priority': '',
      'X-MSMail-Priority': '',
    },
    // 中性 Message-ID 域名，避免泄露服务器主机名/出口 IP
    messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@mail.example.invalid>`,
  });
  return { from: conf.fromEmail || conf.user };
}

/** 发送测试邮件（后台「测试发送」按钮使用） */
export async function sendTestMail(to) {
  const conf = getMailConfig();
  if (!conf.configured) {
    const err = new Error('请先填写 QQ 邮箱账号与 SMTP 授权码并保存');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const vars = { code, action: '配置测试', year: new Date().getFullYear(), site: '小天才圈名平台' };
  const transporter = transporterFor(conf);
  await transporter.verify();
  await transporter.sendMail({
    from: `"${conf.fromName}" <${conf.fromEmail || conf.user}>`,
    to,
    subject: renderTemplate(conf.subject, vars).replace(/&amp;/g, '&'),
    html: renderTemplate(conf.template, vars),
    text: `这是一封来自小天才圈名平台的配置测试邮件，验证码示例：${code}`,
    headers: {
      'X-Mailer': '',
      'X-Priority': '',
      'X-MSMail-Priority': '',
    },
    messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@mail.example.invalid>`,
  });
  return { message: `测试邮件已发送至 ${to}` };
}

export async function verifyMailer() {
  const conf = getMailConfig();
  if (!conf.configured) {
    return { ok: false, error: '尚未配置 QQ 邮箱账号与 SMTP 授权码' };
  }
  try {
    await transporterFor(conf).verify();
    // 安全修正：不回传发信账号原文（避免后台泄露运营方 QQ 号）
    return { ok: true, user: maskAccount(conf.user) };
  } catch (err) {
    console.error('[mail] SMTP 连接校验失败:', err.message);
    return { ok: false, error: err.message };
  }
}

/** 保存后台配置 */
export function saveMailConfig(input = {}) {
  const current = db.settings.mail;
  const next = {
    ...current,
    host: String(input.host || current.host || 'smtp.qq.com').trim(),
    port: Number(input.port) || current.port || 465,
    secure: input.secure !== undefined ? Boolean(input.secure) : current.secure !== false,
    user: String(input.user ?? current.user ?? '').trim(),
    fromName: String(input.fromName ?? current.fromName ?? '小天才圈名平台').trim().slice(0, 40),
    fromEmail: String(input.fromEmail ?? current.fromEmail ?? '').trim(),
    subject: String(input.subject ?? current.subject ?? '').slice(0, 160),
    template: String(input.template ?? current.template ?? ''),
    enabled: true,
  };
  // 密码留空表示不修改
  if (input.pass) next.pass = String(input.pass).trim();
  if (input.clearPass) next.pass = '';
  db.settings.mail = next;
  save();
  invalidateMailerCache();
  return publicMailConfig();
}

/** 当前是否已具备真实发信能力 */
export function isMailConfigured() {
  return getMailConfig().configured;
}


/** 对账号做脱敏：abcd@qq.com → a***@qq.com */
function maskAccount(account) {
  const v = String(account || '');
  const at = v.indexOf('@');
  if (at <= 1) return v ? v.slice(0, 1) + '***' : '';
  return `${v.slice(0, 1)}***${v.slice(at)}`;
}
