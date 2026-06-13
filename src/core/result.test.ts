import { describe, it, expect } from 'vitest';
import {
  aggregateResults,
  getExitCode,
  channelResultFromError,
  ExitCode,
  type ChannelResult,
} from './result.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

/** 构造渠道结果的辅助函数 */
function makeResult(name: string, status: ChannelResult['status'], errorCode?: ErrorCode): ChannelResult {
  return {
    name,
    label: name,
    status,
    error: errorCode
      ? { code: errorCode, message: 'mock', retryable: false }
      : undefined,
  };
}

describe('aggregateResults', () => {
  it('应正确统计成功/失败/跳过数量', () => {
    const result = aggregateResults([
      makeResult('huawei', 'success'),
      makeResult('mi', 'failed', ErrorCode.CHANNEL_UPLOAD_FAILED),
      makeResult('oppo', 'skipped'),
      makeResult('vivo', 'dry_run'),
    ]);
    expect(result.summary).toEqual({ total: 4, success: 2, failed: 1, skipped: 1 });
    expect(result.ok).toBe(false);
  });

  it('全部成功时 ok 为 true', () => {
    const result = aggregateResults([makeResult('huawei', 'success')]);
    expect(result.ok).toBe(true);
  });

  it('应透传 dryRun 标记', () => {
    const result = aggregateResults([makeResult('huawei', 'dry_run')], true);
    expect(result.dryRun).toBe(true);
  });
});

describe('getExitCode', () => {
  it('全部成功返回 SUCCESS', () => {
    const result = aggregateResults([makeResult('huawei', 'success')]);
    expect(getExitCode(result)).toBe(ExitCode.SUCCESS);
  });

  it('部分失败返回 PARTIAL_FAILURE', () => {
    const result = aggregateResults([
      makeResult('huawei', 'success'),
      makeResult('mi', 'failed', ErrorCode.CHANNEL_UPLOAD_FAILED),
    ]);
    expect(getExitCode(result)).toBe(ExitCode.PARTIAL_FAILURE);
  });

  it('全部因版本过低失败返回 VERSION_CHECK_FAILED', () => {
    const result = aggregateResults([
      makeResult('huawei', 'failed', ErrorCode.VERSION_TOO_LOW),
      makeResult('mi', 'failed', ErrorCode.VERSION_TOO_LOW),
    ]);
    expect(getExitCode(result)).toBe(ExitCode.VERSION_CHECK_FAILED);
  });

  it('全部失败但非版本原因返回 ALL_FAILED', () => {
    const result = aggregateResults([
      makeResult('huawei', 'failed', ErrorCode.CHANNEL_UPLOAD_FAILED),
    ]);
    expect(getExitCode(result)).toBe(ExitCode.ALL_FAILED);
  });
});

describe('channelResultFromError', () => {
  it('应保留 ApkpubError 的错误码与可重试标记', () => {
    const err = new ApkpubError({
      code: ErrorCode.NETWORK_ERROR,
      message: '网络异常',
      step: 'upload',
    });
    const result = channelResultFromError('huawei', '华为', err);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe(ErrorCode.NETWORK_ERROR);
    expect(result.error?.step).toBe('upload');
    expect(result.retryable).toBe(true);
  });

  it('应将普通异常包装为 INTERNAL', () => {
    const result = channelResultFromError('mi', '小米', new Error('boom'));
    expect(result.error?.code).toBe(ErrorCode.INTERNAL);
    expect(result.error?.message).toContain('boom');
  });
});
