import AppInfoParser from 'app-info-parser';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { fileSize } from '../utils/files.js';

export interface ApkInfo {
  filePath: string;
  applicationId: string;
  versionCode: number;
  versionName: string;
  size: number;
}

/** 解析 APK 元数据 */
export async function parseApk(filePath: string): Promise<ApkInfo> {
  try {
    const parser = new AppInfoParser(filePath);
    const result = await parser.parse();
    const packageName = result.package as string | undefined;
    const versionCode = Number(result.versionCode);
    const versionName = String(result.versionName ?? '');
    if (!packageName) {
      throw new ApkpubError({
        code: ErrorCode.APK_PARSE_FAILED,
        message: '无法从 APK 中读取包名',
        retryable: false,
      });
    }
    const size = await fileSize(filePath);
    return {
      filePath,
      applicationId: packageName,
      versionCode,
      versionName,
      size,
    };
  } catch (err) {
    if (err instanceof ApkpubError) throw err;
    throw new ApkpubError({
      code: ErrorCode.APK_PARSE_FAILED,
      message: `APK 解析失败: ${err instanceof Error ? err.message : String(err)}`,
      retryable: false,
      cause: err,
    });
  }
}
