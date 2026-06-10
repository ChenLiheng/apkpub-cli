import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

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

/** 校验 URL 是否安全（HTTPS + 非内网） */
export function assertSafeUrl(url: string, label = 'URL'): void {
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
  const host = parsed.hostname;
  if (PRIVATE_IP_PATTERNS.some((p) => p.test(host))) {
    throw new ApkpubError({
      code: ErrorCode.SSRF_BLOCKED,
      message: `${label} 不允许指向内网地址: ${host}`,
      retryable: false,
    });
  }
}

/** 创建带超时与重试的 HTTP 客户端 */
export function createHttpClient(options?: { timeout?: number }): AxiosInstance {
  return axios.create({
    timeout: options?.timeout ?? 60_000,
    validateStatus: () => true,
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
  assertSafeUrl(url, '上传地址');
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
