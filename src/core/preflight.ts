import type { AppConfig } from '../config/schema.js';
import type { Channel } from '../channels/Channel.js';
import { resolveChannels } from '../channels/registry.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

/** 发布前的输入校验结果 */
export interface PublishInputs {
  channels: Channel[];
  updateDesc: string;
}

/**
 * 校验发布输入：更新描述不能为空、至少有一个可用渠道。
 * CLI 与 MCP 共用，保证两个入口的校验规则一致。
 */
export function preparePublishInputs(
  appConfig: AppConfig,
  options: { channels?: string[]; desc?: string },
): PublishInputs {
  const updateDesc = (options.desc ?? appConfig.extension.updateDesc ?? '').trim();
  if (!updateDesc) {
    throw new ApkpubError({
      code: ErrorCode.INVALID_ARGUMENT,
      message: '请提供更新描述（CLI 用 --desc，MCP 用 desc 参数），或在配置 extension.updateDesc 中设置默认值',
      retryable: false,
    });
  }
  const channels = resolveChannels(appConfig, options.channels);
  if (channels.length === 0) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_NOT_FOUND,
      message: '没有可用的发布渠道',
      retryable: false,
    });
  }
  return { channels, updateDesc };
}
