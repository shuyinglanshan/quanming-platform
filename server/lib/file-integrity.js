import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from './db.js';

/**
 * 上传文件完整性校验
 * 为每张图片生成 SHA-256 哈希，落库后可用于：
 *   - 检测文件是否被替换/篡改
 *   - 去重（同一文件重复上传）
 *   - 审计溯源
 */

/** 计算文件 SHA-256 */
export function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(64 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/** 计算 Buffer 的 SHA-256 */
export function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** 给定 /uploads/xxx 形式的 URL，回算磁盘路径并校验哈希 */
export function verifyFileHash(url, expectedHash) {
  if (!url || !expectedHash) return { ok: false, reason: 'missing' };
  const rel = String(url).replace(/^\/uploads\//, '');
  // 防路径穿越：解析后必须仍在 UPLOAD_DIR 内
  const abs = path.resolve(UPLOAD_DIR, rel);
  const root = path.resolve(UPLOAD_DIR);
  if (!abs.startsWith(root + path.sep)) return { ok: false, reason: 'traversal' };
  if (!fs.existsSync(abs)) return { ok: false, reason: 'not_found' };

  const actual = hashFile(abs);
  return {
    ok: actual === expectedHash,
    expected: expectedHash,
    actual,
    reason: actual === expectedHash ? 'ok' : 'hash_mismatch',
  };
}

/** 批量校验一组图片记录 */
export function verifyImageRecords(images) {
  if (!Array.isArray(images)) return { ok: true, checked: 0, failed: [] };
  const failed = [];
  let checked = 0;
  for (const img of images) {
    if (!img?.url) continue;
    // 无哈希的历史数据跳过（不阻断）
    if (!img.sha256) continue;
    checked += 1;
    const res = verifyFileHash(img.url, img.sha256);
    if (!res.ok) failed.push({ url: img.url, reason: res.reason });
  }
  return { ok: failed.length === 0, checked, failed };
}

/* ---------------- 客户端回传的图片记录校验 ---------------- */

const IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
};

// 仅允许本站上传目录下的图片，禁止外链 / javascript: / data: 等协议
const SAFE_UPLOAD_URL = /^\/uploads\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp|gif|heic|heif|avif)$/i;

/**
 * 校验客户端回传的图片记录（evidence JSON）
 *
 * 不信任客户端提交的 url / size / mime / sha256：
 *   - URL 必须指向本站 /uploads 下的图片
 *   - 文件必须真实存在且位于上传目录内（防路径穿越）
 *   - 服务端重新计算 SHA-256；若客户端带了哈希则必须一致
 *   - size / mime / 名称一律以服务端实际文件为准
 */
export function normalizeEvidenceImages(images, max = 6) {
  if (!Array.isArray(images)) return { ok: false, error: '证明材料格式不正确' };
  if (images.length < 1) return { ok: false, error: '请至少上传 1 张证明材料图片' };
  if (images.length > max) return { ok: false, error: `最多上传 ${max} 张材料图片` };

  const root = path.resolve(UPLOAD_DIR);
  const seen = new Set();
  const out = [];

  for (const raw of images) {
    const url = String(raw?.url || '');
    if (!SAFE_UPLOAD_URL.test(url)) {
      return { ok: false, error: '证明材料地址不合法，请重新上传' };
    }
    if (seen.has(url)) continue;
    seen.add(url);

    const abs = path.resolve(root, url.replace(/^\/uploads\//, ''));
    if (!abs.startsWith(root + path.sep)) {
      return { ok: false, error: '证明材料路径不合法' };
    }

    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      return { ok: false, error: '证明材料不存在或已失效，请重新上传' };
    }
    if (!stat.isFile() || stat.size === 0) {
      return { ok: false, error: '证明材料文件无效，请重新上传' };
    }

    const actual = hashFile(abs);
    const claimed = String(raw?.sha256 || '').trim().toLowerCase();
    if (claimed && claimed !== actual) {
      return { ok: false, error: '证明材料哈希校验失败（文件可能被篡改），请重新上传' };
    }

    const ext = path.extname(abs).toLowerCase();
    const uploadedAt = Number.isFinite(Date.parse(String(raw?.uploadedAt || '')))
      ? new Date(raw.uploadedAt).toISOString()
      : new Date().toISOString();

    out.push({
      url,
      name: String(raw?.name || '材料图片').replace(/[<>\r\n]/g, '').slice(0, 80),
      size: stat.size,
      mime: IMAGE_MIME[ext] || '',
      sha256: actual,
      uploadedAt,
    });
  }

  if (!out.length) return { ok: false, error: '请至少上传 1 张证明材料图片' };
  return { ok: true, images: out };
}
