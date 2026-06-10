import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

/** 渠道执行状态 */
export type ChannelStatus = 'success' | 'failed' | 'skipped' | 'dry_run';

/** 单渠道结果 */
export interface ChannelResult {
  name: string;
  label: string;
  status: ChannelStatus;
  retryable?: boolean;
  downloadUrl?: string;
  error?: {
    code: string;
    message: string;
    step?: string;
    retryable: boolean;
  };
}

/** 聚合结果 JSON schema */
export interface PublishResult {
  ok: boolean;
  dryRun: boolean;
  results: ChannelResult[];
  summary: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
  };
}

/** 退出码约定 */
export enum ExitCode {
  SUCCESS = 0,
  INVALID_ARGUMENT = 2,
  VERSION_CHECK_FAILED = 3,
  PARTIAL_FAILURE = 4,
  ALL_FAILED = 5,
  INTERNAL = 1,
}

export function aggregateResults(results: ChannelResult[], dryRun = false): PublishResult {
  const success = results.filter((r) => r.status === 'success' || r.status === 'dry_run').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const ok = failed === 0;
  return {
    ok,
    dryRun,
    results,
    summary: { total: results.length, success, failed, skipped },
  };
}

export function getExitCode(result: PublishResult): ExitCode {
  if (result.ok) return ExitCode.SUCCESS;
  const { success, failed } = result.summary;
  if (failed > 0 && success > 0) return ExitCode.PARTIAL_FAILURE;
  if (failed > 0 && success === 0) {
    const versionErrors = result.results.some((r) => r.error?.code === ErrorCode.VERSION_TOO_LOW);
    if (versionErrors && failed === result.results.length) return ExitCode.VERSION_CHECK_FAILED;
    return ExitCode.ALL_FAILED;
  }
  return ExitCode.INTERNAL;
}

export function channelResultFromError(name: string, label: string, err: unknown): ChannelResult {
  const apkErr = err instanceof ApkpubError ? err : new ApkpubError({ code: ErrorCode.INTERNAL, message: String(err) });
  return {
    name,
    label,
    status: 'failed',
    retryable: apkErr.retryable,
    error: {
      code: apkErr.code,
      message: apkErr.message,
      step: apkErr.step,
      retryable: apkErr.retryable,
    },
  };
}
