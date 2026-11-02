import { describe, it, expect } from 'vitest';
import { mergeResolvedConfig } from './index.js';
import type { CustomChannelConfig } from '../../config/schema.js';

const config: CustomChannelConfig = {
  name: 'my-oss',
  type: 'custom',
  enable: true,
  uploadType: 'oss',
  endpoint: 'oss-cn-hangzhou.aliyuncs.com',
  bucket: 'b',
  objectKeyTemplate: '{fileName}',
  downloadUrlTemplate: 'https://cdn.example.com/{fileName}',
  auth: { mode: 'ak', accessKeyId: 'id', accessKeySecret: '${OSS_SECRET}' },
  headers: { Authorization: '${TOKEN}' },
  params: [],
};

describe('mergeResolvedConfig', () => {
  it('应使用上下文中已解析的 auth 与 headers', () => {
    const merged = mergeResolvedConfig(config, {
      auth: { mode: 'ak', accessKeyId: 'id', accessKeySecret: 'resolved' },
      headers: { Authorization: 'Bearer resolved' },
    });
    expect(merged.auth).toEqual({ mode: 'ak', accessKeyId: 'id', accessKeySecret: 'resolved' });
    expect(merged.headers).toEqual({ Authorization: 'Bearer resolved' });
    expect(merged.bucket).toBe('b');
  });

  it('上下文未提供时保留原始配置', () => {
    const merged = mergeResolvedConfig(config, {});
    expect(merged.auth).toEqual(config.auth);
    expect(merged.headers).toEqual(config.headers);
  });
});
