import express from 'express';
import { requireAuth } from '../lib/auth.js';
import { findUserById, setBinding, clearBinding, consumeBindQuota } from '../lib/repo-user.js';
import {
  providerStatus,
  isProviderEnabled,
  createState,
  consumeState,
  buildAuthorizeUrl,
  exchangeCode,
  saveSocialAccount,
  findOtherBinding,
  removeSocialAccount,
} from '../lib/oauth.js';
import { eventLog } from '../lib/logger.js';
import { notifyUser } from '../lib/notify.js';

const router = express.Router();

const LABEL = { qq: 'QQ', wechat: '微信', xhs: '小红书' };

/* 各平台是否已配置（前端据此显示/隐藏按钮） */
router.get('/providers', (_req, res) => {
  res.json({ providers: providerStatus() });
});

/**
 * 发起绑定
 * 返回授权 URL，前端用 window.open 弹出授权窗口
 */
router.post('/:provider/start', requireAuth, (req, res) => {
  const provider = req.params.provider;
  if (!LABEL[provider]) return res.status(400).json({ error: '不支持的平台' });

  if (!isProviderEnabled(provider)) {
    return res.status(503).json({
      error: `${LABEL[provider]}授权尚未配置，请联系管理员在服务端填写 AppID / AppSecret`,
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  }

  const state = createState(provider, req.user.id, 'bind');
  const url = buildAuthorizeUrl(provider, state);
  if (!url) return res.status(500).json({ error: '生成授权链接失败' });

  eventLog(req, `发起${LABEL[provider]}授权`, req.user.username || req.user.email);
  res.json({ url, state });
});

/**
 * OAuth 回调
 * 平台重定向到此，校验 state → 换取 token → 缓存资料 → 绑定
 * 完成后返回一个自关闭的 HTML，通过 postMessage 通知父窗口
 */
router.get('/:provider/callback', async (req, res) => {
  const provider = req.params.provider;
  const { code, state, error: errCode, error_description } = req.query;

  const html = (ok, message, payload = {}) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>授权结果</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#07070d;color:#e2e8f0;
       font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}
  .box{text-align:center;padding:32px 28px;border-radius:20px;background:rgba(255,255,255,.05);
       border:1px solid rgba(255,255,255,.1);max-width:360px}
  .ico{font-size:40px;margin-bottom:12px}
  h1{font-size:17px;margin:0 0 8px;color:#fff;font-weight:600}
  p{font-size:13px;line-height:1.7;color:#94a3b8;margin:0}
</style></head>
<body><div class="box">
  <div class="ico">${ok ? '✅' : '⚠️'}</div>
  <h1>${ok ? '授权成功' : '授权失败'}</h1>
  <p>${message}</p>
</div>
<script>
  try {
    window.opener && window.opener.postMessage(
      ${JSON.stringify({ type: 'oauth-result', ok, message, ...payload })}, '*');
  } catch (e) {}
  setTimeout(function(){ window.close(); }, ${ok ? 900 : 2200});
</script>
</body></html>`;

  if (errCode) {
    return res.type('html').send(html(false, String(error_description || errCode)));
  }
  if (!code || !state) {
    return res.type('html').send(html(false, '缺少授权参数，请重新发起绑定'));
  }

  const stateCheck = consumeState(String(state));
  if (!stateCheck.ok) {
    return res.type('html').send(html(false, stateCheck.error));
  }
  const { record } = stateCheck;
  if (record.provider !== provider) {
    return res.type('html').send(html(false, '平台校验不一致'));
  }

  const user = findUserById(record.user_id);
  if (!user) return res.type('html').send(html(false, '用户不存在'));

  try {
    const info = await exchangeCode(provider, String(code));

    // 该平台账号是否已被别人绑定
    const occupied = findOtherBinding(provider, info.openId, user.id);
    if (occupied) {
      return res.type('html').send(html(false, `该${LABEL[provider]}账号已被其他用户绑定`));
    }

    // 已绑定则视为「修改」，需消耗每月额度
    const current = user[`bind_${provider === 'xiaohongshu' ? 'xhs' : provider}`];
    const isFirstBind = !current;
    if (!isFirstBind) {
      const quota = consumeBindQuota(user.id);
      if (!quota.ok) return res.type('html').send(html(false, quota.error));
    }

    // 缓存平台资料 + 写入绑定
    saveSocialAccount(provider, info, user.id);
    setBinding(user.id, provider, {
      openId: info.openId,
      nickname: info.nickname,
      avatar: info.avatar,
    });

    eventLog(req, `绑定${LABEL[provider]}`, `${user.username || user.email} → ${info.nickname || info.openId}`);
    notifyUser(user.id, {
      category: 'system',
      level: 'success',
      title: `${LABEL[provider]}账号已绑定`,
      content: `你已成功绑定${LABEL[provider]}账号「${info.nickname || info.openId}」，该信息将展示在圈名详情页。`,
      link: '/me?tab=bindings',
    });

    return res.type('html').send(
      html(true, `已绑定${LABEL[provider]}：${info.nickname || info.openId}`, { provider, nickname: info.nickname }),
    );
  } catch (err) {
    console.error(`[oauth:${provider}]`, err.message);
    eventLog(req, `${LABEL[provider]}授权失败`, err.message, 'error');
    return res.type('html').send(html(false, err.message || '授权处理失败，请重试'));
  }
});

/** 解绑 */
router.delete('/:provider', requireAuth, (req, res) => {
  const provider = req.params.provider;
  if (!LABEL[provider]) return res.status(400).json({ error: '不支持的平台' });

  const col = provider === 'xiaohongshu' ? 'bind_xhs' : `bind_${provider}`;
  if (!req.user[col]) return res.status(400).json({ error: `尚未绑定${LABEL[provider]}` });

  const quota = consumeBindQuota(req.user.id);
  if (!quota.ok) return res.status(429).json({ error: quota.error, usage: quota.usage, code: 'BINDING_LIMIT' });

  removeSocialAccount(provider, req.user.id);
  clearBinding(req.user.id, provider);
  eventLog(req, `解绑${LABEL[provider]}`, req.user.username || req.user.email);

  res.json({ ok: true, usage: quota.usage });
});

export default router;
