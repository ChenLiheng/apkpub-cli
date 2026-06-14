import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveSecret, resolveConfigSecrets, encryptValue } from './resolver.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

describe('resolveSecret', () => {
  const ENV_KEY = 'APKPUB_TEST_SECRET';

  afterEach(() => {
    delete process.env[ENV_KEY];
    delete process.env.APKPUB_MASTER_KEY;
  });

  it('应从环境变量解析占位符', async () => {
    process.env[ENV_KEY] = 'env-value';
    const result = await resolveSecret(`\${${ENV_KEY}}`);
    expect(result).toEqual({ value: 'env-value', source: 'env' });
  });

  it('环境变量未设置时抛 SECRET_RESOLVE_FAILED', async () => {
    await expect(resolveSecret(`\${${ENV_KEY}}`)).rejects.toMatchObject({
      code: ErrorCode.SECRET_RESOLVE_FAILED,
    });
  });

  it('明文值原样返回并标记为 plain', async () => {
    const result = await resolveSecret('plain-text');
    expect(result).toEqual({ value: 'plain-text', source: 'plain' });
  });

  it('加密值缺少 master key 时抛错', async () => {
    await expect(resolveSecret('enc:aa:bb:cc')).rejects.toMatchObject({
      code: ErrorCode.SECRET_RESOLVE_FAILED,
    });
  });

  it('加密/解密往返一致', async () => {
    process.env.APKPUB_MASTER_KEY = 'master-key-1234';
    const encrypted = encryptValue('my-secret', 'master-key-1234');
    expect(encrypted.startsWith('enc:v2:')).toBe(true);
    const result = await resolveSecret(encrypted);
    expect(result.value).toBe('my-secret');
    expect(result.source).toBe('encrypted');
  });

  it('加密值格式无效时抛错', async () => {
    process.env.APKPUB_MASTER_KEY = 'master-key-1234';
    await expect(resolveSecret('enc:onlyonepart')).rejects.toBeInstanceOf(ApkpubError);
  });
});

describe('resolveConfigSecrets', () => {
  const ENV_KEY = 'APKPUB_TEST_CFG';

  beforeEach(() => {
    process.env[ENV_KEY] = 'resolved';
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('应批量解析参数字典并保留空值', async () => {
    const result = await resolveConfigSecrets({
      client_secret: `\${${ENV_KEY}}`,
      client_id: 'public',
      empty: '',
    });
    expect(result).toEqual({
      client_secret: 'resolved',
      client_id: 'public',
      empty: '',
    });
  });
});
