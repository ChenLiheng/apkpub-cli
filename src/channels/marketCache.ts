/**
 * 市场查询结果的通用 TTL 缓存。
 *
 * 用途：一次发布流程内 getMarketState 会被调用多次（Dispatcher 版本校验 + upload 内部），
 * 通过缓存去重，避免重复请求第三方接口触发限流；同时带 TTL 失效，
 * 防止 MCP 等长驻进程读取到陈旧的线上版本信息。
 */
export class MarketStateCache<T> {
  private readonly store = new Map<string, { value: T; expireAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs = 60_000) {
    this.ttlMs = ttlMs;
  }

  /** 读取缓存，命中且未过期才返回；过期自动清除 */
  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expireAt) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  /** 写入缓存并刷新过期时间 */
  set(key: string, value: T): void {
    this.store.set(key, { value, expireAt: Date.now() + this.ttlMs });
  }

  /** 主动清除指定 key 的缓存 */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** 清空全部缓存 */
  clear(): void {
    this.store.clear();
  }
}
