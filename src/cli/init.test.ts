import { describe, expect, it } from 'vitest';
import { buildMarketChannelConfigs, resolveInitApplicationId } from './init.js';
import type { ChannelMeta } from '../channels/registry.js';
import type { ApkInfo } from '../apk/ApkParser.js';

const metas: ChannelMeta[] = [
  {
    name: 'huawei',
    label: '华为',
    type: 'market',
    fileNameIdentify: 'HUAWEI',
    credentialFields: [
      { name: 'client_id', required: true },
      { name: 'client_secret', required: true },
      { name: 'fileNameIdentify', required: false },
    ],
  },
  {
    name: 'mi',
    label: '小米',
    type: 'market',
    fileNameIdentify: 'MI',
    credentialFields: [
      { name: 'account', required: true },
      { name: 'privateKey', required: true },
      { name: 'fileNameIdentify', required: false },
    ],
  },
];

describe('buildMarketChannelConfigs', () => {
  it('非交互模式生成默认 fileNameIdentify 和环境变量占位符', () => {
    const channels = buildMarketChannelConfigs(metas, ['huawei']);
    expect(channels).toEqual([
      {
        name: 'huawei',
        type: 'market',
        enable: true,
        params: [
          { name: 'client_id', value: '${HUAWEI_CLIENT_ID}' },
          { name: 'client_secret', value: '${HUAWEI_CLIENT_SECRET}' },
          { name: 'fileNameIdentify', value: 'HUAWEI' },
        ],
      },
    ]);
  });

  it('只生成显式选择的渠道', () => {
    const channels = buildMarketChannelConfigs(metas, ['mi']);
    expect(channels.map((channel) => channel.name)).toEqual(['mi']);
  });
});

describe('resolveInitApplicationId', () => {
  const apkInfo: ApkInfo = {
    filePath: '/tmp/app.apk',
    applicationId: 'com.example.fromapk',
    versionCode: 1,
    versionName: '1.0.0',
    size: 1024,
  };

  it('优先使用显式 --app', async () => {
    const appId = await resolveInitApplicationId('com.example.explicit', '/tmp/app.apk', async () => apkInfo);
    expect(appId).toBe('com.example.explicit');
  });

  it('未传 --app 时从 APK 读取 applicationId', async () => {
    const appId = await resolveInitApplicationId(undefined, '/tmp/app.apk', async () => apkInfo);
    expect(appId).toBe('com.example.fromapk');
  });
});
