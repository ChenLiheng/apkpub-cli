import { describe, it, expect, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import { assertSafeUrl, assertSafeUrlAsync, withRetry } from './http.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

function mockLookupAll(address: string): void {
  vi.mocked(lookup).mockResolvedValueOnce([{ address, family: 4 }] as never);
}

describe('assertSafeUrl', () => {
  it('允许公网 https 地址', () => {
    expect(() => assertSafeUrl('https://example.com/upload')).not.toThrow();
  });

  it('默认拒绝 HTTP 明文协议', () => {
    try {
      assertSafeUrl('http://example.com/upload');
      expect.unreachable('应当抛出异常');
    } catch (err) {
      expect((err as ApkpubError).code).toBe(ErrorCode.SSRF_BLOCKED);
    }
  });

  it('允许显式启用 HTTP', () => {
    expect(() => assertSafeUrl('http://example.com/upload', 'URL', { allowHttp: true })).not.toThrow();
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
    'http://[::1]/x',
    'http://[fc00::1]/x',
    'http://[fe80::1]/x',
    'http://2130706433/x',
  ])('拒绝内网地址 %s', (url) => {
    try {
      assertSafeUrl(url);
      expect.unreachable('应当抛出异常');
    } catch (err) {
      expect((err as ApkpubError).code).toBe(ErrorCode.SSRF_BLOCKED);
    }
  });
});

describe('assertSafeUrlAsync', () => {
  it('允许 DNS 解析到公网地址', async () => {
    mockLookupAll('93.184.216.34');
    await expect(assertSafeUrlAsync('https://example.com/upload')).resolves.toBeUndefined();
  });

  it('拒绝 DNS 解析到内网地址', async () => {
    mockLookupAll('10.0.0.2');
    await expect(assertSafeUrlAsync('https://internal.example.com/upload')).rejects.toMatchObject({
      code: ErrorCode.SSRF_BLOCKED,
    });
  });

  it('HTTP 兼容模式会输出安全警告到 stderr', async () => {
    mockLookupAll('93.184.216.34');
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await assertSafeUrlAsync('http://example.com/upload', '上传地址', { allowHttp: true, warnOnHttp: true });
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 明文 URL'));
    writeSpy.mockRestore();
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
