import { describe, it, expect, vi, afterEach } from 'vitest';
import { MarketStateCache } from './marketCache.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('MarketStateCache', () => {
  it('命中未过期的缓存', () => {
    const cache = new MarketStateCache<number>(60_000);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });

  it('未命中返回 undefined', () => {
    const cache = new MarketStateCache<number>();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('超过 TTL 后自动失效', () => {
    vi.useFakeTimers();
    const cache = new MarketStateCache<number>(1000);
    cache.set('a', 1);
    vi.advanceTimersByTime(500);
    expect(cache.get('a')).toBe(1);
    vi.advanceTimersByTime(600);
    expect(cache.get('a')).toBeUndefined();
  });

  it('delete 主动清除', () => {
    const cache = new MarketStateCache<number>();
    cache.set('a', 1);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
  });

  it('clear 清空全部', () => {
    const cache = new MarketStateCache<number>();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});
