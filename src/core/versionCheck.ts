import type { ApkInfo } from '../apk/ApkParser.js';
import type { MarketInfo } from '../channels/Channel.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

/** 校验 APK 版本号是否大于线上版本 */
export function checkVersion(apkInfo: ApkInfo, marketInfo: MarketInfo | undefined, channelName: string): void {
  if (!marketInfo) return;
  if (apkInfo.versionCode <= marketInfo.lastVersionCode) {
    throw new ApkpubError({
      code: ErrorCode.VERSION_TOO_LOW,
      channel: channelName,
      message: `要提交的 APK 版本号(${apkInfo.versionCode})需大于线上最新版本号(${marketInfo.lastVersionCode})`,
      retryable: false,
    });
  }
}

/** 校验 APK 包名是否匹配配置 */
export function checkPackageMatch(apkInfo: ApkInfo, expectedAppId: string): void {
  if (apkInfo.applicationId !== expectedAppId) {
    throw new ApkpubError({
      code: ErrorCode.INVALID_ARGUMENT,
      message: `APK 包名(${apkInfo.applicationId})与配置(${expectedAppId})不匹配`,
      retryable: false,
    });
  }
}
