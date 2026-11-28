import { describe, it, expect, vi } from 'vitest';
import { TokenCache, clearAllTokenCaches } from './tokenCache.js';

describe('TokenCache', () => {
  it('同一凭证复用 token，并发请求只取一次', async () => {
    const cache = new TokenCache();
    const fetch = vi.fn(async () => 'tok');
    const [a, b] = await Promise.all([cache.get('id', 'secret', fetch), cache.get('id', 'secret', fetch)]);
    expect([a, b]).toEqual(['tok', 'tok']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('不同密钥分别获取', async () => {
    const cache = new TokenCache();
    const fetch = vi.fn(async () => 'tok');
    await cache.get('id', 's1', fetch);
    await cache.get('id', 's2', fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('获取失败不缓存，下次重新获取', async () => {
    const cache = new TokenCache();
    const fetch = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('tok');
    await expect(cache.get('id', 'secret', fetch)).rejects.toThrow('boom');
    await expect(cache.get('id', 'secret', fetch)).resolves.toBe('tok');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('clearAllTokenCaches 清空全部实例', async () => {
    const cache = new TokenCache();
    const fetch = vi.fn(async () => 'tok');
    await cache.get('id', 'secret', fetch);
    clearAllTokenCaches();
    await cache.get('id', 'secret', fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('TokenCache 失效与取消', () => {
  it('invalidate 后重新获取', async () => {
    const cache = new TokenCache();
    const fetch = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    expect(await cache.get('id', 'secret', fetch)).toBe('old');
    cache.invalidate('id', 'secret');
    expect(await cache.get('id', 'secret', fetch)).toBe('new');
  });

  it('一个调用方取消只影响自己，其他等待者照常拿到 token', async () => {
    const cache = new TokenCache();
    let resolveToken!: (v: string) => void;
    const fetch = vi.fn(() => new Promise<string>((r) => (resolveToken = r)));
    const controller = new AbortController();
    const first = cache.get('id', 'secret', fetch, controller.signal);
    const second = cache.get('id', 'secret', fetch);
    controller.abort();
    resolveToken('tok');
    await expect(first).rejects.toMatchObject({ code: 'TIMEOUT' });
    await expect(second).resolves.toBe('tok');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
