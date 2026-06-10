import { createPublicKey, publicEncrypt, constants } from 'node:crypto';

const GROUP_SIZE = 128; // 1024-bit RSA
const ENCRYPT_GROUP_SIZE = GROUP_SIZE - 11;

/** 小米 API RSA 加密（X509 公钥） */
export function rsaEncrypt(content: string, publicKeyPem: string): string {
  const pem = normalizePublicKey(publicKeyPem);
  const publicKey = createPublicKey(pem);
  const data = Buffer.from(content, 'utf8');
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < data.length) {
    const remain = data.length - offset;
    const segSize = Math.min(remain, ENCRYPT_GROUP_SIZE);
    const segment = data.subarray(offset, offset + segSize);
    const encrypted = publicEncrypt(
      { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
      segment,
    );
    chunks.push(encrypted);
    offset += segSize;
  }
  return Buffer.concat(chunks).toString('hex');
}

function normalizePublicKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes('BEGIN CERTIFICATE')) {
    return trimmed;
  }
  if (trimmed.includes('BEGIN PUBLIC KEY')) {
    return trimmed;
  }
  return `-----BEGIN CERTIFICATE-----\n${trimmed}\n-----END CERTIFICATE-----`;
}
