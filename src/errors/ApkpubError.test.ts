import { describe, it, expect } from 'vitest';
import { ApkpubError, ErrorCode, toApkpubError } from './ApkpubError.js';

describe('ApkpubError', () => {
  it('网络类错误默认可重试', () => {
    const err = new ApkpubError({ code: ErrorCode.NETWORK_ERROR, message: 'net' });
    expect(err.retryable).toBe(true);
  });

  it('超时类错误默认可重试', () => {
    expect(new ApkpubError({ code: ErrorCode.TIMEOUT, message: 't' }).retryable).toBe(true);
  });

  it('非网络类错误默认不可重试', () => {
    expect(new ApkpubError({ code: ErrorCode.INVALID_ARGUMENT, message: 'x' }).retryable).toBe(false);
  });

  it('显式 retryable 覆盖默认值', () => {
    const err = new ApkpubError({ code: ErrorCode.NETWORK_ERROR, message: 'net', retryable: false });
    expect(err.retryable).toBe(false);
  });

  it('保留 channel/step 元信息', () => {
    const err = new ApkpubError({
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      message: 'fail',
      channel: 'huawei',
      step: 'upload',
    });
    expect(err.channel).toBe('huawei');
    expect(err.step).toBe('upload');
    expect(err.name).toBe('ApkpubError');
  });
});

describe('toApkpubError', () => {
  it('ApkpubError 原样返回', () => {
    const original = new ApkpubError({ code: ErrorCode.TIMEOUT, message: 't' });
    expect(toApkpubError(original)).toBe(original);
  });

  it('普通 Error 包装为 INTERNAL 并保留 cause', () => {
    const raw = new Error('boom');
    const wrapped = toApkpubError(raw);
    expect(wrapped).toBeInstanceOf(ApkpubError);
    expect(wrapped.code).toBe(ErrorCode.INTERNAL);
    expect(wrapped.message).toBe('boom');
    expect(wrapped.cause).toBe(raw);
  });

  it('支持指定 fallback 错误码与上下文', () => {
    const wrapped = toApkpubError('string error', {
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      channel: 'mi',
      step: 'auth',
    });
    expect(wrapped.code).toBe(ErrorCode.CHANNEL_UPLOAD_FAILED);
    expect(wrapped.channel).toBe('mi');
    expect(wrapped.step).toBe('auth');
  });
});
