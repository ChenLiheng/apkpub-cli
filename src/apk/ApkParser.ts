import AppInfoParser from 'app-info-parser';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { fileSize } from '../utils/files.js';

export interface ApkInfo {
  filePath: string;
  applicationId: string;
  versionCode: number;
  versionName: string;
  size: number;
  /** 应用名（取自 manifest application label，无法解析时为 undefined） */
  appName?: string;
}

/** 从解析结果中提取应用名：label 可能是字符串、多语言数组或未解析的资源引用 */
function extractAppName(label: unknown): string | undefined {
  const candidates = Array.isArray(label) ? label : [label];
  for (const item of candidates) {
    if (typeof item === 'string' && item.trim() !== '' && !item.startsWith('resourceId:')) {
      return item.trim();
    }
  }
  return undefined;
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
    if (!Number.isInteger(versionCode) || versionCode <= 0) {
      throw new ApkpubError({
        code: ErrorCode.APK_PARSE_FAILED,
        message: `无法从 APK 中读取有效的 versionCode: ${String(result.versionCode)}`,
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
      appName: extractAppName((result.application as { label?: unknown } | undefined)?.label),
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
