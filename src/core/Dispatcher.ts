import pLimit from 'p-limit';
import type { AppConfig } from '../config/schema.js';
import type { Channel } from '../channels/Channel.js';
import { resolveConfigSecrets } from '../secrets/resolver.js';
import { checkPackageMatch, checkVersion } from './versionCheck.js';
import { TaskLauncher } from './TaskLauncher.js';
import {
  aggregateResults,
  channelResultFromError,
  type ChannelResult,
  type PublishResult,
} from './result.js';
import { writeAuditLog } from '../config/store.js';
import { logger } from '../utils/logger.js';

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
        });

        try {
          const rawParams = TaskLauncher.getRawParams(chConfig);
          const resolved = await resolveConfigSecrets(rawParams, {
            service: 'apkpub-cli',
            account: `${appConfig.applicationId}/${channel.name}`,
          });
          launcher.injectConfig(resolved);
          await launcher.selectFile();
          const apkInfo = await launcher.prepare();
          checkPackageMatch(apkInfo, appConfig.applicationId);

          if (channel.getMarketState) {
            const marketState = await channel.getMarketState(appConfig.applicationId, launcher.getConfig());
            checkVersion(apkInfo, marketState, channel.name);
          }

          if (dryRun) {
            logger.info(channel.name, `[dry-run] 预检通过，将上传 ${apkInfo.versionName}(${apkInfo.versionCode})`);
            return { name: channel.name, label: channel.label, status: 'dry_run' };
          }

          const result = await channel.upload({
            apkInfo,
            filePath: launcher.getFilePath(),
            desc: updateDesc,
            config: launcher.getConfig(),
            onProgress: ({ step, percent }) => {
              options.onChannelProgress?.(channel.name, step, percent);
            },
            signal: signal ?? new AbortController().signal,
          });

          await writeAuditLog({
            action: 'publish',
            appId: appConfig.applicationId,
            channels: [channel.name],
            versionCode: apkInfo.versionCode,
            result: 'success',
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
          }).catch(() => {});
          return channelResultFromError(channel.name, channel.label, err);
        }
      };
    });

    const results = await Promise.all(tasks.map((task) => limit(task)));
    return aggregateResults(results, dryRun);
  }
}
