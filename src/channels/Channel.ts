import type { ZodSchema } from 'zod';
import type { ApkInfo } from '../apk/ApkParser.js';

/** 审核状态 */
export type ReviewState = 'online' | 'reviewing' | 'rejected' | 'unknown';

/** 市场信息 */
export interface MarketInfo {
  reviewState: ReviewState;
  enableSubmit: boolean;
  lastVersionCode: number;
  lastVersionName: string;
}

/** 上传结果 */
export interface UploadResult {
  downloadUrl?: string;
  message?: string;
}

/** 上传上下文 */
export interface UploadContext {
  apkInfo: ApkInfo;
  filePath: string;
  desc: string;
  config: Record<string, unknown>;
  dryRun?: boolean;
  onProgress: (p: { step: string; percent?: number }) => void;
  signal: AbortSignal;
}

/** 渠道接口 */
export interface Channel {
  name: string;
  label: string;
  type: 'market' | 'custom';
  fileNameIdentify: string;
  credentialSchema: ZodSchema;
  getMarketState?(appId: string, config: Record<string, unknown>): Promise<MarketInfo | undefined>;
  upload(ctx: UploadContext): Promise<UploadResult>;
  /** 预检凭证（doctor 用） */
  validateCredentials?(config: Record<string, unknown>): Promise<void>;
}
