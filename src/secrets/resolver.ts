import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { logger } from '../utils/logger.js';

const SALT = 'apkpub-salt';
const KEY_LENGTH = 32;

function deriveKey(masterKey: string, salt: string): Buffer {
  return scryptSync(masterKey, salt, KEY_LENGTH);
}

const ENV_PLACEHOLDER_RE = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

export type SecretSource = 'env' | 'keychain' | 'encrypted' | 'plain';

export interface ResolveOptions {
  service?: string;
  account?: string;
}

/** 解析密钥值，按优先级 env > keychain > encrypted > plain */
export async function resolveSecret(
  value: string,
  options: ResolveOptions = {},
): Promise<{ value: string; source: SecretSource }> {
  const envMatch = value.match(ENV_PLACEHOLDER_RE);
  if (envMatch) {
    const envVal = process.env[envMatch[1]];
    if (!envVal) {
      throw new ApkpubError({
        code: ErrorCode.SECRET_RESOLVE_FAILED,
        message: `环境变量 ${envMatch[1]} 未设置`,
        retryable: false,
      });
    }
    return { value: envVal, source: 'env' };
  }

  if (value.startsWith('keychain:')) {
    const key = value.slice('keychain:'.length);
    const resolved = await resolveFromKeychain(options.service ?? 'apkpub-cli', key);
    return { value: resolved, source: 'keychain' };
  }

  if (value.startsWith('enc:')) {
    const resolved = await decryptValue(value.slice('enc:'.length));
    return { value: resolved, source: 'encrypted' };
  }

  if (looksLikeSecret(value)) {
    logger.warn('secrets', '检测到明文密钥，建议迁移到环境变量或 keychain');
  }
  return { value, source: 'plain' };
}

/** 批量解析配置对象中的字符串值 */
export async function resolveConfigSecrets(
  params: Record<string, string>,
  options: ResolveOptions = {},
): Promise<Record<string, string>> {
  const entries = Object.entries(params);
  const resolved = await Promise.all(
    entries.map(async ([key, val]) => {
      if (typeof val === 'string' && val.length > 0) {
        const result = await resolveSecret(val, { ...options, account: key });
        return [key, result.value] as const;
      }
      return [key, val] as const;
    }),
  );
  return Object.fromEntries(resolved);
}

async function resolveFromKeychain(service: string, account: string): Promise<string> {
  try {
    const keytar = await import('keytar');
    const password = await keytar.getPassword(service, account);
    if (!password) {
      throw new ApkpubError({
        code: ErrorCode.SECRET_RESOLVE_FAILED,
        message: `keychain 中未找到 ${service}/${account}`,
        retryable: false,
      });
    }
    return password;
  } catch (err) {
    if (err instanceof ApkpubError) throw err;
    throw new ApkpubError({
      code: ErrorCode.SECRET_RESOLVE_FAILED,
      message: `keychain 不可用，请安装 keytar 或改用环境变量: ${err instanceof Error ? err.message : String(err)}`,
      retryable: false,
      cause: err,
    });
  }
}

async function decryptValue(encrypted: string): Promise<string> {
  const masterKey = process.env.APKPUB_MASTER_KEY;
  if (!masterKey) {
    throw new ApkpubError({
      code: ErrorCode.SECRET_RESOLVE_FAILED,
      message: '解密需要设置环境变量 APKPUB_MASTER_KEY',
      retryable: false,
    });
  }
  const parts = encrypted.split(':');
  let salt: string;
  let ivHex: string;
  let authTagHex: string;
  let cipherHex: string;
  if (parts[0] === 'v2' && parts.length === 5) {
    [, salt, ivHex, authTagHex, cipherHex] = parts;
  } else if (parts.length === 3) {
    [ivHex, authTagHex, cipherHex] = parts;
    salt = SALT;
  } else {
    throw new ApkpubError({
      code: ErrorCode.SECRET_RESOLVE_FAILED,
      message: '加密值格式无效',
      retryable: false,
    });
  }
  const key = deriveKey(masterKey, salt!);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function looksLikeSecret(value: string): boolean {
  if (value.length < 16) return false;
  return /secret|key|token|password/i.test(value) === false && /^[A-Za-z0-9+/=_-]{16,}$/.test(value);
}

/** 将明文密钥存入 keychain */
export async function storeInKeychain(service: string, account: string, password: string): Promise<void> {
  const keytar = await import('keytar');
  await keytar.setPassword(service, account, password);
}

/** 生成加密后的密钥值（用于配置文件） */
export function encryptValue(plaintext: string, masterKey: string): string {
  const salt = randomBytes(16).toString('hex');
  const key = deriveKey(masterKey, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:v2:${salt}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** 配置文件权限校验 */
export function hashConfigForAudit(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
