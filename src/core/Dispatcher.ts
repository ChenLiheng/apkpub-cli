import pLimit from 'p-limit';
import type { AppConfig } from '../config/schema.js';
import type { Channel } from '../channels/Channel.js';
import { checkPackageMatch, checkSubmittable, checkVersion } from './versionCheck.js';
import { TaskLauncher } from './TaskLauncher.js';
import {
  aggregateResults,
  channelResultFromError,
  type ChannelResult,
  type PublishResult,
} from './result.js';
import { writeAuditLog } from '../config/store.js';
import { logger } from '../utils/logger.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { parseApk, type ApkInfo } from '../apk/ApkParser.js';

/** 取消时抛出统一的「操作已取消」错误 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ApkpubError({ code: ErrorCode.TIMEOUT, message: '操作已取消', retryable: false });
  }
}

/** 创建按文件路径缓存的 APK 解析函数：单文件发布到多个渠道时只解析一次，每个渠道拿到独立副本 */
function createCachedParser(): (filePath: string) => Promise<ApkInfo> {
  const cache = new Map<string, Promise<ApkInfo>>();
  return async (filePath) => {
    let pending = cache.get(filePath);
    if (!pending) {
      pending = parseApk(filePath);
      // 解析失败不缓存，交由各渠道各自报错
      pending.catch(() => cache.delete(filePath));
      cache.set(filePath, pending);
    }
    // 返回副本，避免某个渠道修改后影响其他渠道
    return { ...(await pending) };
  };
}

export interface DispatchOptions {
  appConfig: AppConfig;
  channels: Channel[];
  apkPath: string;
  updateDesc: string;
  dryRun?: boolean;
  parallel?: number;
  signal?: AbortSignal;
  onChannelProgress?: (channel: string, step: string, percent?: number) => void;
}

/** 分发编排器 */
export class Dispatcher {
  async dispatch(options: DispatchOptions): Promise<PublishResult> {
    const { appConfig, channels, apkPath, updateDesc, dryRun, parallel = 1, signal } = options;
    const limit = pLimit(Math.max(1, parallel));
    const cachedParseApk = createCachedParser();

    const tasks = channels.map((channel) => {
      const chConfig = appConfig.channels.find((c) => c.name === channel.name);
      if (!chConfig || !chConfig.enable) {
        return async (): Promise<ChannelResult> => ({
          name: channel.name,
          label: channel.label,
          status: 'skipped',
        });
      }

      return async (): Promise<ChannelResult> => {
        const launcher = new TaskLauncher({
          channel,
          channelConfig: chConfig,
          apkPath,
          enableChannel: appConfig.enableChannel,
          parseApk: cachedParseApk,
        });

        try {
          throwIfAborted(signal);
          await launcher.resolveConfig(appConfig.applicationId);
          await launcher.selectFile();
          const apkInfo = await launcher.prepare();
          logger.debug(
            channel.name,
            `已选择 ${launcher.getFilePath()}：${apkInfo.applicationId} ${apkInfo.versionName}(${apkInfo.versionCode})`,
          );
          checkPackageMatch(apkInfo, appConfig.applicationId);

          if (channel.getMarketState) {
            throwIfAborted(signal);
            const marketState = await channel.getMarketState(appConfig.applicationId, launcher.getConfig(), {
              signal,
            });
            logger.debug(
              channel.name,
              marketState
                ? `线上状态 ${marketState.reviewState}，版本 ${marketState.lastVersionName}(${marketState.lastVersionCode})`
                : '未返回线上状态',
            );
            checkVersion(apkInfo, marketState, channel.name);
            checkSubmittable(marketState, channel.name);
          }

          if (dryRun) {
            logger.info(channel.name, `[dry-run] 预检通过，将上传 ${apkInfo.versionName}(${apkInfo.versionCode})`);
            return { name: channel.name, label: channel.label, status: 'dry_run' };
          }

          throwIfAborted(signal);

          const result = await channel.upload({
            apkInfo,
            filePath: launcher.getFilePath(),
            desc: updateDesc,
            config: launcher.getConfig(),
            onProgress: ({ step, percent }) => {
              options.onChannelProgress?.(channel.name, step, percent);
            },
            signal: signal ?? AbortSignal.timeout(24 * 60 * 60 * 1000),
          });

          // 上传已成功：审计日志写入失败只告警，不能把已提交的渠道误报为失败
          await writeAuditLog({
            action: 'publish',
            appId: appConfig.applicationId,
            channels: [channel.name],
            versionCode: apkInfo.versionCode,
            result: 'success',
          }).catch((err: unknown) => {
            logger.warn(channel.name, `审计日志写入失败: ${err instanceof Error ? err.message : String(err)}`);
          });

          return {
            name: channel.name,
            label: channel.label,
            status: 'success',
            downloadUrl: result.downloadUrl,
          };
        } catch (err) {
          logger.error(channel.name, err instanceof Error ? err.message : String(err));
          await writeAuditLog({
            action: 'publish',
            appId: appConfig.applicationId,
            channels: [channel.name],
            result: 'failed',
          }).catch((auditErr: unknown) => {
            logger.warn(
              channel.name,
              `审计日志写入失败: ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`,
            );
          });
          return channelResultFromError(channel.name, channel.label, err);
        }
      };
    });

    const results = await Promise.all(tasks.map((task) => limit(task)));
    return aggregateResults(results, dryRun);
  }
}
