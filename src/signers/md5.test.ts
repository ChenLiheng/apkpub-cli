import { describe, it, expect } from 'vitest';
import { md5Hex, md5Sign } from './md5.js';

describe('md5', () => {
  it('md5Hex 应返回 32 位十六进制', () => {
    expect(md5Hex('hello')).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  it('md5Sign 应拼接 signKey', () => {
    const result = md5Sign('{}', 'key');
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });
});
