/** 错误码枚举 */
export enum ErrorCode {
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
  CONFIG_INVALID = 'CONFIG_INVALID',
  APK_PARSE_FAILED = 'APK_PARSE_FAILED',
  APK_NOT_FOUND = 'APK_NOT_FOUND',
  APK_AMBIGUOUS = 'APK_AMBIGUOUS',
  VERSION_TOO_LOW = 'VERSION_TOO_LOW',
  CHANNEL_NOT_FOUND = 'CHANNEL_NOT_FOUND',
  CHANNEL_AUTH_FAILED = 'CHANNEL_AUTH_FAILED',
  CHANNEL_UPLOAD_FAILED = 'CHANNEL_UPLOAD_FAILED',
  CHANNEL_STATE_FAILED = 'CHANNEL_STATE_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  SSRF_BLOCKED = 'SSRF_BLOCKED',
  SECRET_RESOLVE_FAILED = 'SECRET_RESOLVE_FAILED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INTERNAL = 'INTERNAL',
}

/** 统一错误模型 */
export class ApkpubError extends Error {
  readonly code: ErrorCode;
  readonly channel?: string;
  readonly step?: string;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(options: {
    code: ErrorCode;
    message: string;
    channel?: string;
    step?: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = 'ApkpubError';
    this.code = options.code;
    this.channel = options.channel;
    this.step = options.step;
    this.retryable = options.retryable ?? isRetryableCode(options.code);
    this.cause = options.cause;
  }
}

function isRetryableCode(code: ErrorCode): boolean {
  return [ErrorCode.NETWORK_ERROR, ErrorCode.TIMEOUT, ErrorCode.CHANNEL_UPLOAD_FAILED].includes(code);
}

export function toApkpubError(err: unknown, fallback?: Partial<{ code: ErrorCode; channel: string; step: string }>): ApkpubError {
  if (err instanceof ApkpubError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ApkpubError({
    code: fallback?.code ?? ErrorCode.INTERNAL,
    message,
    channel: fallback?.channel,
    step: fallback?.step,
    cause: err,
  });
}
