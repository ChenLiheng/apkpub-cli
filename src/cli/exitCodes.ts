import { ExitCode } from '../core/result.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

/** 命令整体失败（未进入逐渠道结果）时，按错误码映射进程退出码 */
export function getErrorExitCode(err: ApkpubError): ExitCode {
  switch (err.code) {
    case ErrorCode.VERSION_TOO_LOW:
      return ExitCode.VERSION_CHECK_FAILED;
    case ErrorCode.INVALID_ARGUMENT:
    case ErrorCode.CONFIG_NOT_FOUND:
    case ErrorCode.CONFIG_INVALID:
    case ErrorCode.APK_NOT_FOUND:
    case ErrorCode.APK_AMBIGUOUS:
    case ErrorCode.CHANNEL_NOT_FOUND:
    case ErrorCode.SECRET_RESOLVE_FAILED:
      return ExitCode.INVALID_ARGUMENT;
    default:
      return ExitCode.INTERNAL;
  }
}
