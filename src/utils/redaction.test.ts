import { describe, it, expect } from 'vitest';
import { redact, redactMessage } from './redaction.js';

describe('redact', () => {
  it('应脱敏对象中的敏感键', () => {
    const result = redact({
      clientId: 'public-id',
      client_secret: 'super-secret-value',
      privateKey: 'PEM',
      token: 'abc',
    });
    expect(result.clientId).toBe('public-id');
    expect(result.client_secret).toBe('***REDACTED***');
    expect(result.privateKey).toBe('***REDACTED***');
    expect(result.token).toBe('***REDACTED***');
  });

  it('应递归脱敏嵌套对象与数组', () => {
    const result = redact({
      channels: [{ name: 'huawei', password: 'p@ss' }],
    });
    expect(result.channels[0].name).toBe('huawei');
    expect(result.channels[0].password).toBe('***REDACTED***');
  });

  it('应缩略长随机字符串', () => {
    const long = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
    expect(redact(long)).toBe('ABCD...3456');
  });

  it('普通短字符串保持不变', () => {
    expect(redact('hello world')).toBe('hello world');
  });

  it('null/undefined 原样返回', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});

describe('redactMessage', () => {
  it('应脱敏 URL 查询参数中的密钥', () => {
    const msg = redactMessage('请求失败 client_secret=abcdef123&foo=bar');
    expect(msg).toContain('client_secret=***');
    expect(msg).toContain('foo=bar');
  });

  it('应脱敏 Bearer token', () => {
    expect(redactMessage('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer ***');
  });
});
