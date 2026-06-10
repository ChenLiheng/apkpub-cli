const SENSITIVE_KEYS = [
  'secret',
  'password',
  'privatekey',
  'private_key',
  'accesskeysecret',
  'access_key_secret',
  'accesstoken',
  'access_token',
  'token',
  'signkey',
  'sign_key',
  'authorization',
];

const REDACTED = '***REDACTED***';

/** 判断键名是否为敏感字段 */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[-_]/g, '');
  return SENSITIVE_KEYS.some((k) => lower.includes(k.replace(/[-_]/g, '')));
}

/** 递归脱敏对象 */
export function redact<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length > 20 && /^[A-Za-z0-9+/=_-]{20,}$/.test(value)) {
      return `${value.slice(0, 4)}...${value.slice(-4)}` as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item)) as T;
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = isSensitiveKey(k) ? REDACTED : redact(v);
    }
    return result as T;
  }
  return value;
}

/** 脱敏错误消息中的敏感内容 */
export function redactMessage(message: string): string {
  return message
    .replace(/(client_secret|access_key_secret|privateKey|password|signKey)=[^&\s]+/gi, '$1=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');
}
