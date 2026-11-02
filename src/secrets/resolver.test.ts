import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveSecret, resolveConfigSecrets, resolveCustomChannelSecrets, encryptValue } from './resolver.js';
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

describe('resolveCustomChannelSecrets', () => {
  afterEach(() => {
    delete process.env.APKPUB_TEST_OSS_SECRET;
    delete process.env.APKPUB_TEST_SIGN_KEY;
    delete process.env.APKPUB_TEST_HEADER_TOKEN;
  });

  const base = {
    name: 'my-oss',
    type: 'custom' as const,
    enable: true,
    uploadType: 'oss' as const,
    objectKeyTemplate: '{fileName}',
    downloadUrlTemplate: 'https://cdn.example.com/{fileName}',
    params: [],
  };

  it('应解析 AK 模式下 auth 中的环境变量占位符', async () => {
    process.env.APKPUB_TEST_OSS_SECRET = 'real-oss-secret';
    const resolved = await resolveCustomChannelSecrets({
      ...base,
      auth: { mode: 'ak', accessKeyId: 'ak-id', accessKeySecret: '${APKPUB_TEST_OSS_SECRET}' },
    });
    expect(resolved.auth).toEqual({ mode: 'ak', accessKeyId: 'ak-id', accessKeySecret: 'real-oss-secret' });
  });

  it('应解析 STS 模式的 signKey 与 headers 中的占位符', async () => {
    process.env.APKPUB_TEST_SIGN_KEY = 'real-sign-key';
    process.env.APKPUB_TEST_HEADER_TOKEN = 'Bearer abc';
    const resolved = await resolveCustomChannelSecrets({
      ...base,
      auth: { mode: 'sts', stsTokenUrl: 'https://sts.example.com', signKey: '${APKPUB_TEST_SIGN_KEY}', contextB: '{}' },
      headers: { Authorization: '${APKPUB_TEST_HEADER_TOKEN}', 'X-Plain': 'v' },
    });
    expect(resolved.auth).toMatchObject({ mode: 'sts', signKey: 'real-sign-key' });
    expect(resolved.headers).toEqual({ Authorization: 'Bearer abc', 'X-Plain': 'v' });
  });

  it('环境变量缺失时抛 SECRET_RESOLVE_FAILED', async () => {
    await expect(
      resolveCustomChannelSecrets({
        ...base,
        auth: { mode: 'ak', accessKeyId: 'id', accessKeySecret: '${APKPUB_TEST_OSS_SECRET}' },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.SECRET_RESOLVE_FAILED });
  });
});
