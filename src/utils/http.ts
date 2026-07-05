import { lookup } from 'node:dns/promises';
import net from 'node:net';
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { redactMessage } from './redaction.js';

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
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

function isPrivateIPv4(host: string): boolean {
  const parts = parseIPv4(host);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(host: string): boolean {
  const normalized = normalizeHost(host);
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.') ||
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  );
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

/** 创建带超时与重试的 HTTP 客户端 */
export function createHttpClient(options?: { timeout?: number }): AxiosInstance {
  return axios.create({
    timeout: options?.timeout ?? 60_000,
    validateStatus: () => true,
    beforeRedirect: assertSafeRedirect,
  });
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
    if (options.signal?.aborted) {
      throw new ApkpubError({ code: ErrorCode.TIMEOUT, message: '操作已取消', retryable: false });
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable = err instanceof ApkpubError ? err.retryable : true;
      if (!retryable || i === retries) break;
      await sleep(delayMs * Math.pow(2, i), options.signal);
    }
  }
  throw lastError;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new ApkpubError({ code: ErrorCode.TIMEOUT, message: '操作已取消', retryable: false }));
    });
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
