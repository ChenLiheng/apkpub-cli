import { createHash } from 'node:crypto';

/** 计算 MD5 十六进制 */
export function md5Hex(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

/** 计算字符串 MD5（用于 STS 签名） */
export function md5Sign(data: string, signKey: string): string {
  return md5Hex(data + signKey);
}
