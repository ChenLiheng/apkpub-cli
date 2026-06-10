import { describe, it, expect } from 'vitest';
import { hmacSha256, signSortedParams, vivoSignParams } from './hmac.js';

describe('hmacSha256', () => {
  it('应返回固定长度的十六进制字符串', () => {
    const result = hmacSha256('test', 'secret');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('相同输入应产生相同输出', () => {
    expect(hmacSha256('data', 'key')).toBe(hmacSha256('data', 'key'));
  });
});

describe('signSortedParams', () => {
  it('应按 key 排序后签名', () => {
    const result = signSortedParams({ b: '2', a: '1' }, 'secret');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('vivoSignParams', () => {
  it('应包含 sign 字段', () => {
    const params = vivoSignParams('ak', 'sk', 'app.query.details', { packageName: 'com.test' });
    expect(params.sign).toBeDefined();
    expect(params.access_key).toBe('ak');
    expect(params.method).toBe('app.query.details');
  });
});
