import { createHash } from 'node:crypto';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { MarketStateCache } from './marketCache.js';

/** token 缓存时长：远小于各市场 token 有效期，长驻进程（MCP）中也能及时刷新 */
const TOKEN_TTL_MS = 10 * 60_000;

const allCaches = new Set<TokenCache>();

function cancelledError(): ApkpubError {
  return new ApkpubError({ code: ErrorCode.TIMEOUT, message: '操作已取消', retryable: false });
}

/** 等待共享的 Promise，但只响应调用方自己的取消信号；取消时只放弃等待，不影响其他等待者 */
function waitWithSignal<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(cancelledError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(cancelledError());
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/**
 * 渠道 access token 缓存：同一次发布中 getMarketState 与 upload 复用同一个 token，
 * 并发请求共享同一个进行中的 Promise。缓存键使用凭证摘要，不在内存键中保存明文密钥。
 */
export class TokenCache {
  private readonly cache = new MarketStateCache<Promise<string>>(TOKEN_TTL_MS);

  constructor() {
    allCaches.add(this);
  }

  private key(clientId: string, clientSecret: string): string {
    return createHash('sha256').update(`${clientId}\0${clientSecret}`).digest('hex');
  }

  /**
   * 命中缓存直接返回，否则调用 fetch 获取；获取失败不缓存。
   * fetch 不应绑定任何调用方的取消信号（多个调用方共享同一个请求），signal 只控制本调用方是否继续等待。
   */
  get(clientId: string, clientSecret: string, fetch: () => Promise<string>, signal?: AbortSignal): Promise<string> {
    const key = this.key(clientId, clientSecret);
    let pending = this.cache.get(key);
    if (!pending) {
      const created = fetch();
      created.catch(() => {
        // 只清除自己写入的条目，避免误删之后重新获取的 token
        if (this.cache.get(key) === created) this.cache.delete(key);
      });
      this.cache.set(key, created);
      pending = created;
    }
    return waitWithSignal(pending, signal);
  }

  /** 使缓存的 token 失效：市场请求失败时调用，下次重试会重新获取（token 可能已被吊销） */
  invalidate(clientId: string, clientSecret: string): void {
    this.cache.delete(this.key(clientId, clientSecret));
  }

  clear(): void {
    this.cache.clear();
  }
}

/** 清空所有渠道的 token 缓存（测试用） */
export function clearAllTokenCaches(): void {
  for (const cache of allCaches) cache.clear();
}
