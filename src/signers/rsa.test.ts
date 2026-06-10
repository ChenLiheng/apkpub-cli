import { describe, it, expect } from 'vitest';
import { rsaEncrypt } from './rsa.js';

describe('rsaEncrypt', () => {
  it('无效公钥应抛出错误', () => {
    expect(() => rsaEncrypt('test', 'invalid-key')).toThrow();
  });

  it('空内容应抛出错误', () => {
    expect(() => rsaEncrypt('', 'invalid')).toThrow();
  });
});
