import type { AppConfig, ChannelConfig } from '../config/schema.js';
import type { Channel, MarketInfo } from '../channels/Channel.js';
import { resolveChannels } from '../channels/registry.js';
import { ApkpubError, ErrorCode, toApkpubError } from '../errors/ApkpubError.js';
import { TaskLauncher } from './TaskLauncher.js';

/** 单渠道市场状态查询结果 */
export interface ChannelStatusResult {
  name: string;
  label: string;
  /** 是否查询成功；自定义渠道无市场状态，视为成功 */
  ok: boolean;
  /** 渠道不支持市场状态查询（自定义渠道） */
  unsupported?: boolean;
  state?: MarketInfo;
  error?: { code: string; message: string };
}

/** 单渠道体检结果 */
export interface ChannelDoctorResult {
  name: string;
  label: string;
  ok: boolean;
  error?: { code: string; message: string };
}

function findChannelConfig(appConfig: AppConfig, channel: Channel): ChannelConfig {
  const chConfig = appConfig.channels.find((c) => c.name === channel.name);
  if (!chConfig) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_NOT_FOUND,
      channel: channel.name,
      message: `渠道 ${channel.name} 未在配置中启用`,
      retryable: false,
    });
  }
  return chConfig;
}

/** 构造渠道运行时配置：与发布链路一致，解析参数与自定义渠道 auth/headers 中的密钥占位符 */
async function resolveRuntimeConfig(
  appConfig: AppConfig,
  channel: Channel,
): Promise<Record<string, unknown>> {
  const launcher = new TaskLauncher({
    channel,
    channelConfig: findChannelConfig(appConfig, channel),
    apkPath: '',
    enableChannel: appConfig.enableChannel,
  });
  return launcher.resolveConfig(appConfig.applicationId);
}

function toErrorInfo(err: unknown): { code: string; message: string } {
  const apkErr = toApkpubError(err);
  return { code: apkErr.code, message: apkErr.message };
}

/** 查询各渠道线上状态：各渠道并发查询（结果保持渠道顺序），单渠道失败不影响其他渠道 */
export async function queryMarketStatus(
  appConfig: AppConfig,
  channelNames?: string[],
  signal?: AbortSignal,
): Promise<ChannelStatusResult[]> {
  const channels = resolveChannels(appConfig, channelNames);
  return Promise.all(
    channels.map(async (channel): Promise<ChannelStatusResult> => {
      if (!channel.getMarketState) {
        return { name: channel.name, label: channel.label, ok: true, unsupported: true };
      }
      try {
        const config = await resolveRuntimeConfig(appConfig, channel);
        const state = await channel.getMarketState(appConfig.applicationId, config, { signal });
        return { name: channel.name, label: channel.label, ok: true, state };
      } catch (err) {
        return { name: channel.name, label: channel.label, ok: false, error: toErrorInfo(err) };
      }
    }),
  );
}

/** 体检各渠道：解析密钥并调用渠道的凭证预检 */
export async function runDoctor(appConfig: AppConfig): Promise<ChannelDoctorResult[]> {
  const channels = resolveChannels(appConfig);
  const results: ChannelDoctorResult[] = [];
  for (const channel of channels) {
    try {
      const config = await resolveRuntimeConfig(appConfig, channel);
      if (channel.validateCredentials) await channel.validateCredentials(config);
      results.push({ name: channel.name, label: channel.label, ok: true });
    } catch (err) {
      results.push({ name: channel.name, label: channel.label, ok: false, error: toErrorInfo(err) });
    }
  }
  return results;
}
