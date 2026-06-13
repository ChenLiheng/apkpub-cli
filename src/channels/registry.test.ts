import { describe, it, expect } from 'vitest';
import {
  getBuiltinChannels,
  loadChannelsFromConfig,
  resolveChannels,
  getChannelMetas,
} from './registry.js';
import type { AppConfig } from '../config/schema.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

/** 构造含若干渠道的应用配置 */
function configWith(channels: AppConfig['channels']): AppConfig {
  return {
    schemaVersion: 1,
    name: 'app',
    applicationId: 'com.example.app',
    createTime: 1,
    enableChannel: true,
    channels,
    extension: {},
  };
}

describe('getBuiltinChannels', () => {
  it('应包含五大内置市场渠道', () => {
    const names = getBuiltinChannels().map((c) => c.name).sort();
    expect(names).toEqual(['honor', 'huawei', 'mi', 'oppo', 'vivo']);
  });
});

describe('loadChannelsFromConfig', () => {
  it('应跳过未启用的渠道', () => {
    const channels = loadChannelsFromConfig(
      configWith([
        { name: 'huawei', type: 'market', enable: true, params: [] },
        { name: 'mi', type: 'market', enable: false, params: [] },
      ]),
    );
    expect(channels.map((c) => c.name)).toEqual(['huawei']);
  });

  it('应忽略不存在的内置渠道名', () => {
    const channels = loadChannelsFromConfig(
      configWith([{ name: 'unknown', type: 'market', enable: true, params: [] }]),
    );
    expect(channels).toHaveLength(0);
  });

  it('应加载自定义渠道', () => {
    const channels = loadChannelsFromConfig(
      configWith([
        {
          name: 'my-http',
          type: 'custom',
          enable: true,
          uploadType: 'http',
          uploadUrl: 'https://example.com/upload',
          objectKeyTemplate: '{fileName}',
          downloadUrlTemplate: 'https://cdn.example.com/{fileName}',
          params: [],
        },
      ]),
    );
    expect(channels.map((c) => c.name)).toEqual(['my-http']);
    expect(channels[0].type).toBe('custom');
  });
});

describe('resolveChannels', () => {
  const config = configWith([
    { name: 'huawei', type: 'market', enable: true, params: [] },
    { name: 'mi', type: 'market', enable: true, params: [] },
  ]);

  it('未指定名称时返回全部启用渠道', () => {
    expect(resolveChannels(config).map((c) => c.name)).toEqual(['huawei', 'mi']);
  });

  it('按名称解析指定渠道', () => {
    expect(resolveChannels(config, ['mi']).map((c) => c.name)).toEqual(['mi']);
  });

  it('解析未启用渠道时抛 CHANNEL_NOT_FOUND', () => {
    try {
      resolveChannels(config, ['oppo']);
      expect.unreachable('应当抛出异常');
    } catch (err) {
      expect(err).toBeInstanceOf(ApkpubError);
      expect((err as ApkpubError).code).toBe(ErrorCode.CHANNEL_NOT_FOUND);
    }
  });
});

describe('getChannelMetas', () => {
  it('每个渠道都应携带凭证字段与文件名标识', () => {
    const metas = getChannelMetas();
    const huawei = metas.find((m) => m.name === 'huawei');
    expect(huawei).toBeDefined();
    expect(huawei?.credentialFields.some((f) => f.name === 'client_secret')).toBe(true);
    expect(huawei?.credentialFields.some((f) => f.name === 'fileNameIdentify')).toBe(true);
  });
});
