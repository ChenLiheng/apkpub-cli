import { lookup } from 'node:dns/promises';
import net from 'node:net';
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { redactMessage } from './redaction.js';

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
  /^169\.254\./,
];

const HTTP_WARNING = '检测到 HTTP 明文 URL，仅为兼容旧配置继续执行；建议改用 HTTPS';

interface SafeUrlOptions {
  allowHttp?: boolean;
  warnOnHttp?: boolean;
}

function normalizeHost(host: string): string {
  return host.replace(/^\[(.*)\]$/, '$1').toLowerCase();
}

function parseIPv4(host: string): number[] | null {
  const normalized = normalizeHost(host);
  if (/^\d+$/.test(normalized)) {
    const value = Number(normalized);
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return null;
    return [
      (value >>> 24) & 255,
      (value >>> 16) & 255,
      (value >>> 8) & 255,
      value & 255,
    ];
  }
  const parts = normalized.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => {
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : NaN;
  });
  return nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

/** 禁止访问的 IPv4 网段：本机 / 私网 / 链路本地 / CGNAT / 保留 / 组播 / 广播 */
const BLOCKED_IPV4_RANGES: [number, number, number, number, number][] = [
  [0, 0, 0, 0, 8],
  [10, 0, 0, 0, 8],
  [100, 64, 0, 0, 10],
  [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16],
  [172, 16, 0, 0, 12],
  [192, 0, 0, 0, 24],
  [192, 168, 0, 0, 16],
  [198, 18, 0, 0, 15],
  [224, 0, 0, 0, 4],
  [240, 0, 0, 0, 4],
];

function ipv4ToInt(parts: number[]): number {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIPv4(host: string): boolean {
  const parts = parseIPv4(host);
  if (!parts) return false;
  const value = ipv4ToInt(parts);
  return BLOCKED_IPV4_RANGES.some(([a, b, c, d, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((value & mask) >>> 0) === ((ipv4ToInt([a, b, c, d]) & mask) >>> 0);
  });
}

/** 将 IPv6 地址展开为 8 组 16 位整数，非法时返回 null */
function expandIPv6(host: string): number[] | null {
  let addr = normalizeHost(host);
  if (net.isIPv6(addr) === false) return null;
  // 末尾内嵌 IPv4（如 ::ffff:127.0.0.1）转换为两组十六进制
  const embedded = addr.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) {
    const v4 = parseIPv4(embedded[2]);
    if (!v4) return null;
    addr = `${embedded[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const [head, tail] = addr.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = tail !== undefined ? 8 - headParts.length - tailParts.length : 0;
  const groups = [...headParts, ...Array(fill).fill('0'), ...tailParts].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPrivateIPv6(host: string): boolean {
  const g = expandIPv6(host);
  if (!g) return false;
  const allZeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);
  // :: 与 ::1
  if (allZeroPrefix(7) && (g[7] === 0 || g[7] === 1)) return true;
  // IPv4 映射（::ffff:a.b.c.d）、IPv4 兼容（::a.b.c.d）、NAT64（64:ff9b::/96）：按内嵌 IPv4 判断
  const isMapped = allZeroPrefix(5) && g[5] === 0xffff;
  const isCompat = allZeroPrefix(6);
  const isNat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if (isMapped || isCompat || isNat64) {
    const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    return isPrivateIPv4(v4);
  }
  // fc00::/7 唯一本地地址、fe80::/10 链路本地、ff00::/8 组播
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00;
}

function isBlockedHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return (
    PRIVATE_IP_PATTERNS.some((p) => p.test(host) || p.test(normalized)) ||
    isPrivateIPv4(normalized) ||
    isPrivateIPv6(normalized)
  );
}

function warnHttp(url: string, label: string): void {
  process.stderr.write(`[security] ${HTTP_WARNING}: ${label} ${redactMessage(url)}\n`);
}

/** 校验 URL 是否安全（默认仅 HTTPS + 非内网） */
export function assertSafeUrl(url: string, label = 'URL', options?: SafeUrlOptions): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApkpubError({
      code: ErrorCode.INVALID_ARGUMENT,
      message: `无效的 ${label}: ${url}`,
      retryable: false,
    });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ApkpubError({
      code: ErrorCode.SSRF_BLOCKED,
      message: `${label} 仅支持 http/https 协议`,
      retryable: false,
    });
  }
  if (parsed.protocol === 'http:' && !options?.allowHttp) {
    throw new ApkpubError({
      code: ErrorCode.SSRF_BLOCKED,
      message: `${label} 不允许使用 HTTP 明文协议，请使用 HTTPS`,
      retryable: false,
    });
  }
  if (parsed.protocol === 'http:' && options?.allowHttp && options.warnOnHttp) {
    warnHttp(url, label);
  }
  const host = parsed.hostname;
  if (isBlockedHost(host)) {
    throw new ApkpubError({
      code: ErrorCode.SSRF_BLOCKED,
      message: `${label} 不允许指向内网地址: ${host}`,
      retryable: false,
    });
  }
}

/** 校验 URL，并解析 DNS 防止域名指向内网地址 */
export async function assertSafeUrlAsync(url: string, label = 'URL', options?: SafeUrlOptions): Promise<void> {
  assertSafeUrl(url, label, options);
  const parsed = new URL(url);
  if (net.isIP(normalizeHost(parsed.hostname)) !== 0 || isBlockedHost(parsed.hostname)) return;
  const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  for (const address of addresses) {
    if (isBlockedHost(address.address)) {
      throw new ApkpubError({
        code: ErrorCode.SSRF_BLOCKED,
        message: `${label} DNS 解析到内网地址: ${address.address}`,
        retryable: false,
      });
    }
  }
}

interface RedirectOptions {
  protocol?: string;
  hostname?: string;
  host?: string;
  path?: string;
  href?: string;
}

function assertSafeRedirect(options: RedirectOptions): void {
  const host = options.hostname ?? options.host;
  if (!host) return;
  const protocol = options.protocol ?? 'https:';
  const path = options.path ?? '/';
  assertSafeUrl(`${protocol}//${host}${path}`, '重定向地址', { allowHttp: true, warnOnHttp: true });
}

/** 创建带超时、取消信号与重定向校验的 HTTP 客户端 */
export function createHttpClient(options?: { timeout?: number; signal?: AbortSignal }): AxiosInstance {
  return axios.create({
    timeout: options?.timeout ?? 60_000,
    signal: options?.signal,
    validateStatus: () => true,
    beforeRedirect: assertSafeRedirect,
  });
}

function cancelledError(): ApkpubError {
  return new ApkpubError({ code: ErrorCode.TIMEOUT, message: '操作已取消', retryable: false });
}

/** 带指数退避的重试执行 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; delayMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const delayMs = options.delayMs ?? 1000;
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    if (options.signal?.aborted) throw cancelledError();
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (options.signal?.aborted || axios.isCancel(err)) throw cancelledError();
      const retryable = err instanceof ApkpubError ? err.retryable : true;
      if (!retryable || i === retries) break;
      await sleep(delayMs * Math.pow(2, i), options.signal);
    }
  }
  throw lastError;
}

/** 可被取消的延时；取消时抛「操作已取消」 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(cancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 校验响应体为 JSON 对象（网关错误页、空响应等返回可重试错误） */
export function ensureJsonObject(
  data: unknown,
  meta: { channel: string; step: string; status?: number },
): Record<string, any> {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, any>;
  }
  throw new ApkpubError({
    code: ErrorCode.CHANNEL_UPLOAD_FAILED,
    channel: meta.channel,
    step: meta.step,
    message: `${meta.step} 响应格式无效${meta.status !== undefined ? ` (HTTP ${meta.status})` : ''}`,
    retryable: meta.status === undefined || meta.status >= 500,
  });
}

/** 上传文件并报告进度 */
export async function uploadWithProgress(
  client: AxiosInstance,
  url: string,
  data: Buffer | NodeJS.ReadableStream,
  config: AxiosRequestConfig & {
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  await assertSafeUrlAsync(url, '上传地址', { allowHttp: true, warnOnHttp: true });
  const response = await client.request({
    method: config.method ?? 'PUT',
    url,
    data,
    headers: config.headers,
    signal: config.signal,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    onUploadProgress: (event) => {
      if (event.total && config.onProgress) {
        config.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      message: `上传失败 HTTP ${response.status}`,
      retryable: response.status >= 500,
    });
  }
}
