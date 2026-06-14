import type { AppConfig, ChannelConfig } from '../config/schema.js';
import type { Channel } from './Channel.js';
import { huaweiChannel } from './huawei/index.js';
import { honorChannel } from './honor/index.js';
import { miChannel } from './mi/index.js';
import { oppoChannel } from './oppo/index.js';
import { vivoChannel } from './vivo/index.js';
import { createCustomChannel } from './custom/index.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

/** 内置市场渠道 */
const BUILTIN_MARKET_CHANNELS: Channel[] = [
  huaweiChannel,
  honorChannel,
  miChannel,
  oppoChannel,
  vivoChannel,
];

/** 获取所有内置市场渠道 */
export function getBuiltinChannels(): Channel[] {
  return [...BUILTIN_MARKET_CHANNELS];
}

/** 从应用配置加载全部渠道（内置 + 自定义） */
export function loadChannelsFromConfig(appConfig: AppConfig): Channel[] {
  const channels: Channel[] = [];
  const builtinMap = new Map(BUILTIN_MARKET_CHANNELS.map((c) => [c.name, c]));

  for (const chConfig of appConfig.channels) {
    if (!chConfig.enable) continue;
    if (chConfig.type === 'custom') {
      channels.push(createCustomChannel(chConfig));
    } else {
      const builtin = builtinMap.get(chConfig.name);
      if (builtin) channels.push(builtin);
    }
  }
  return channels;
}

/** 按名称解析渠道列表 */
export function resolveChannels(
  appConfig: AppConfig,
  channelNames?: string[],
): Channel[] {
  const all = loadChannelsFromConfig(appConfig);
  if (!channelNames || channelNames.length === 0) {
    return all;
  }
  const resolved: Channel[] = [];
  for (const name of channelNames) {
    const ch = all.find((c) => c.name === name);
    if (!ch) {
      throw new ApkpubError({
        code: ErrorCode.CHANNEL_NOT_FOUND,
        message: `渠道 "${name}" 未在配置中启用或不存在`,
        retryable: false,
      });
    }
    resolved.push(ch);
  }
  return resolved;
}

/** 渠道元信息（describe 用） */
export interface ChannelMeta {
  name: string;
  label: string;
  type: 'market' | 'custom';
  fileNameIdentify: string;
  credentialFields: { name: string; required: boolean; description?: string }[];
}

const MARKET_CREDENTIALS: Record<string, ChannelMeta['credentialFields']> = {
  huawei: [
    { name: 'client_id', required: true, description: '华为 Connect API 客户端 ID' },
    { name: 'client_secret', required: true, description: '华为 Connect API 密钥' },
  ],
  honor: [
    { name: 'client_id', required: true, description: '荣耀开发者凭证 ID' },
    { name: 'client_secret', required: true, description: '荣耀开发者凭证密钥' },
  ],
  mi: [
    { name: 'account', required: true, description: '小米开发者账号（邮箱）' },
    { name: 'publicKey', required: true, description: '公钥证书内容' },
    { name: 'privateKey', required: true, description: '私钥' },
  ],
  oppo: [
    { name: 'client_id', required: true, description: 'OPPO 服务端应用 ID' },
    { name: 'client_secret', required: true, description: 'OPPO 服务端应用密钥' },
  ],
  vivo: [
    { name: 'access_key', required: true, description: 'VIVO API Access Key' },
    { name: 'access_secret', required: true, description: 'VIVO API Access Secret' },
  ],
};

export function getChannelMetas(): ChannelMeta[] {
  return BUILTIN_MARKET_CHANNELS.map((ch) => ({
    name: ch.name,
    label: ch.label,
    type: ch.type,
    fileNameIdentify: ch.fileNameIdentify,
    credentialFields: [
      ...(MARKET_CREDENTIALS[ch.name] ?? []),
      { name: 'fileNameIdentify', required: false, description: '多渠道包文件名匹配标识' },
    ],
  }));
}

export function getCustomChannelMeta(config: ChannelConfig): ChannelMeta | null {
  if (config.type !== 'custom') return null;
  return {
    name: config.name,
    label: config.name,
    type: 'custom',
    fileNameIdentify: config.fileNameIdentify ?? config.name,
    credentialFields: [
      { name: 'uploadType', required: true, description: 'oss 或 http' },
      { name: 'objectKeyTemplate', required: true, description: '对象路径模板' },
      { name: 'downloadUrlTemplate', required: true, description: '下载链接模板' },
    ],
  };
}
