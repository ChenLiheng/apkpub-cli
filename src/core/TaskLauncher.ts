import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { Channel } from '../channels/Channel.js';
import type { ApkInfo } from '../apk/ApkParser.js';
import type { ChannelConfig } from '../config/schema.js';
import { paramsToRecord } from '../config/schema.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { listApkFiles } from '../utils/files.js';
import { parseApk } from '../apk/ApkParser.js';

export interface TaskLauncherOptions {
  channel: Channel;
  channelConfig: ChannelConfig;
  apkPath: string;
  enableChannel: boolean;
}

/** 单渠道任务启动器 */
export class TaskLauncher {
  readonly channel: Channel;
  readonly channelConfig: ChannelConfig;
  private apkPath: string;
  private enableChannel: boolean;
  private resolvedFile?: string;
  private apkInfo?: ApkInfo;
  private config: Record<string, unknown> = {};

  constructor(options: TaskLauncherOptions) {
    this.channel = options.channel;
    this.channelConfig = options.channelConfig;
    this.apkPath = options.apkPath;
    this.enableChannel = options.enableChannel;
  }

  /** 注入渠道配置参数 */
  injectConfig(resolvedParams: Record<string, string>): void {
    if (this.channelConfig.type === 'custom') {
      this.config = { ...this.channelConfig, ...resolvedParams };
    } else {
      this.config = { ...resolvedParams };
      const fileId = resolvedParams.fileNameIdentify ?? this.channel.fileNameIdentify;
      this.config.fileNameIdentify = fileId;
    }
  }

  /** 匹配并选择 APK 文件 */
  async selectFile(): Promise<string> {
    const info = await stat(this.apkPath);
    if (info.isFile()) {
      this.resolvedFile = this.apkPath;
      return this.resolvedFile;
    }
    if (!this.enableChannel) {
      throw new ApkpubError({
        code: ErrorCode.APK_NOT_FOUND,
        channel: this.channel.name,
        message: '多渠道模式未启用，请指定单个 APK 文件',
        retryable: false,
      });
    }
    const fileId = String(this.config.fileNameIdentify ?? this.channel.fileNameIdentify);
    const apks = await listApkFiles(this.apkPath);
    const matches = apks.filter((f) => path.basename(f).toLowerCase().includes(fileId.toLowerCase()));
    if (matches.length === 0) {
      throw new ApkpubError({
        code: ErrorCode.APK_NOT_FOUND,
        channel: this.channel.name,
        message: `找不到文件名中包含 "${fileId}" 的 APK 文件`,
        retryable: false,
      });
    }
    if (matches.length > 1) {
      throw new ApkpubError({
        code: ErrorCode.APK_AMBIGUOUS,
        channel: this.channel.name,
        message: `匹配到多个 APK 文件，请确保唯一: ${matches.map((f) => path.basename(f)).join(', ')}`,
        retryable: false,
      });
    }
    this.resolvedFile = matches[0];
    return this.resolvedFile;
  }

  /** 解析 APK 信息 */
  async prepare(): Promise<ApkInfo> {
    const file = this.resolvedFile ?? (await this.selectFile());
    this.apkInfo = await parseApk(file);
    return this.apkInfo;
  }

  getFilePath(): string {
    if (!this.resolvedFile) {
      throw new ApkpubError({
        code: ErrorCode.APK_NOT_FOUND,
        message: '尚未选择 APK 文件',
        retryable: false,
      });
    }
    return this.resolvedFile;
  }

  getApkInfo(): ApkInfo {
    if (!this.apkInfo) {
      throw new ApkpubError({
        code: ErrorCode.APK_PARSE_FAILED,
        message: '尚未解析 APK',
        retryable: false,
      });
    }
    return this.apkInfo;
  }

  getConfig(): Record<string, unknown> {
    return this.config;
  }

  /** 从渠道配置提取原始参数 */
  static getRawParams(channelConfig: ChannelConfig): Record<string, string> {
    if (channelConfig.type === 'custom') {
      return paramsToRecord(channelConfig.params ?? []);
    }
    return paramsToRecord(channelConfig.params);
  }
}
