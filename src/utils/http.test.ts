import { describe, it, expect, vi } from 'vitest';
import { assertSafeUrl, withRetry } from './http.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

describe('assertSafeUrl', () => {
  it('允许公网 https 地址', () => {
    expect(() => assertSafeUrl('https://example.com/upload')).not.toThrow();
  });

  it('允许公网 http 地址', () => {
    expect(() => assertSafeUrl('http://example.com/upload')).not.toThrow();
  });

  it('拒绝非法 URL', () => {
    try {
      assertSafeUrl('not-a-url');
      expect.unreachable('应当抛出异常');
    } catch (err) {
      expect((err as ApkpubError).code).toBe(ErrorCode.INVALID_ARGUMENT);
    }
  });

  it('拒绝非 http/https 协议', () => {
    try {
      assertSafeUrl('ftp://example.com/file');
      expect.unreachable('应当抛出异常');
    } catch (err) {
      expect((err as ApkpubError).code).toBe(ErrorCode.SSRF_BLOCKED);
    }
  });

  it.each([
    'http://localhost/x',
    'http://127.0.0.1/x',
    'http://10.0.0.1/x',
    'http://172.16.0.1/x',
    'http://192.168.1.1/x',
    'http://169.254.1.1/x',
  ])('拒绝内网地址 %s', (url) => {
    try {
      assertSafeUrl(url);
      expect.unreachable('应当抛出异常');
    } catch (err) {
      expect((err as ApkpubError).code).toBe(ErrorCode.SSRF_BLOCKED);
    }
  });
});

describe('withRetry', () => {
  it('首次成功不重试', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { retries: 3, delayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('可重试错误会重试到成功', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ApkpubError({ code: ErrorCode.NETWORK_ERROR, message: 'net' }))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { retries: 3, delayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('不可重试错误立即抛出', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new ApkpubError({ code: ErrorCode.INVALID_ARGUMENT, message: 'bad', retryable: false }));
    await expect(withRetry(fn, { retries: 3, delayMs: 0 })).rejects.toBeInstanceOf(ApkpubError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('超过重试次数后抛出最后一次错误', async () => {
    const fn = vi.fn().mockRejectedValue(new ApkpubError({ code: ErrorCode.TIMEOUT, message: 'timeout' }));
    await expect(withRetry(fn, { retries: 2, delayMs: 0 })).rejects.toBeInstanceOf(ApkpubError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('已取消的信号立即抛 TIMEOUT', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { signal: controller.signal })).rejects.toBeInstanceOf(ApkpubError);
    expect(fn).not.toHaveBeenCalled();
  });
});
