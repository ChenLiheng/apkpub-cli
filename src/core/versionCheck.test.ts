import { describe, it, expect } from 'vitest';
import { checkVersion, checkPackageMatch, checkSubmittable } from './versionCheck.js';
import type { ApkInfo } from '../apk/ApkParser.js';
import type { MarketInfo } from '../channels/Channel.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

/** 构造 APK 信息的辅助函数 */
function makeApk(overrides: Partial<ApkInfo> = {}): ApkInfo {
  return {
    filePath: '/tmp/app.apk',
    applicationId: 'com.example.app',
    versionCode: 100,
    versionName: '1.0.0',
    size: 1024,
    ...overrides,
  };
}

/** 构造线上市场信息的辅助函数 */
function makeMarket(overrides: Partial<MarketInfo> = {}): MarketInfo {
  return {
    reviewState: 'online',
    enableSubmit: true,
    lastVersionCode: 90,
    lastVersionName: '0.9.0',
    ...overrides,
  };
}

describe('checkVersion', () => {
  it('线上信息缺失时直接通过', () => {
    expect(() => checkVersion(makeApk(), undefined, 'huawei')).not.toThrow();
  });

  it('版本号大于线上时通过', () => {
    expect(() => checkVersion(makeApk({ versionCode: 100 }), makeMarket({ lastVersionCode: 90 }), 'huawei')).not.toThrow();
  });

  it('版本号等于线上时抛 VERSION_TOO_LOW', () => {
    try {
      checkVersion(makeApk({ versionCode: 90 }), makeMarket({ lastVersionCode: 90 }), 'huawei');
      expect.unreachable('应当抛出异常');
    } catch (err) {
      expect(err).toBeInstanceOf(ApkpubError);
      expect((err as ApkpubError).code).toBe(ErrorCode.VERSION_TOO_LOW);
      expect((err as ApkpubError).channel).toBe('huawei');
    }
  });

  it('版本号小于线上时抛 VERSION_TOO_LOW', () => {
    expect(() => checkVersion(makeApk({ versionCode: 80 }), makeMarket({ lastVersionCode: 90 }), 'mi')).toThrow(ApkpubError);
  });
});

describe('checkPackageMatch', () => {
  it('包名一致时通过', () => {
    expect(() => checkPackageMatch(makeApk(), 'com.example.app')).not.toThrow();
  });

  it('包名不一致时抛 INVALID_ARGUMENT', () => {
    try {
      checkPackageMatch(makeApk({ applicationId: 'com.other.app' }), 'com.example.app');
      expect.unreachable('应当抛出异常');
    } catch (err) {
      expect(err).toBeInstanceOf(ApkpubError);
      expect((err as ApkpubError).code).toBe(ErrorCode.INVALID_ARGUMENT);
    }
  });
});

describe('checkSubmittable', () => {
  it('线上信息缺失或允许提交时通过', () => {
    expect(() => checkSubmittable(undefined, 'huawei')).not.toThrow();
    expect(() => checkSubmittable(makeMarket(), 'huawei')).not.toThrow();
  });

  it('市场处于审核中时抛 CHANNEL_NOT_SUBMITTABLE 且不可重试', () => {
    try {
      checkSubmittable(makeMarket({ reviewState: 'reviewing', enableSubmit: false }), 'huawei');
      expect.unreachable('应当抛出异常');
    } catch (err) {
      expect(err).toBeInstanceOf(ApkpubError);
      expect((err as ApkpubError).code).toBe(ErrorCode.CHANNEL_NOT_SUBMITTABLE);
      expect((err as ApkpubError).retryable).toBe(false);
      expect((err as ApkpubError).channel).toBe('huawei');
    }
  });
});
