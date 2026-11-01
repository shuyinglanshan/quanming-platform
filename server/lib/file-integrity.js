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
