import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** 计算文件 MD5 */
export async function fileMd5(filePath: string): Promise<string> {
  return hashFile(filePath, 'md5');
}

/** 计算文件 SHA256 */
export async function fileSha256(filePath: string): Promise<string> {
  return hashFile(filePath, 'sha256');
}

async function hashFile(filePath: string, algorithm: 'md5' | 'sha256'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** 列出目录下所有 APK 文件 */
export async function listApkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const results = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry);
      const info = await stat(full);
      return info.isFile() && entry.toLowerCase().endsWith('.apk') ? full : null;
    }),
  );
  return results.filter((f): f is string => f !== null);
}

/** 获取文件大小 */
export async function fileSize(filePath: string): Promise<number> {
  const info = await stat(filePath);
  return info.size;
}
