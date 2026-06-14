import { describe, it, expect } from 'vitest';
import { TaskLauncher } from './TaskLauncher.js';
import { ApkpubError } from '../errors/ApkpubError.js';
import type { Channel } from '../channels/Channel.js';
import type { MarketChannelConfig, CustomChannelConfig } from '../config/schema.js';

function makeChannel(name = 'test'): Channel {
  return {
    name,
    label: name,
    type: 'market',
    fileNameIdentify: name.toUpperCase(),
    credentialSchema: { parse: () => ({}) } as never,
    async upload() {
      return { message: 'ok' };
    },
  };
}

function makeChannelConfig(name = 'test'): MarketChannelConfig {
  return {
    name,
    type: 'market',
    enable: true,
    params: [
      { name: 'client_id', value: 'id-123' },
      { name: 'client_secret', value: 'secret-456' },
    ],
  };
}

describe('TaskLauncher', () => {
  describe('getRawParams', () => {
    it('从市场渠道配置提取参数字典', () => {
      const config = makeChannelConfig();
      const params = TaskLauncher.getRawParams(config);
      expect(params).toEqual({
        client_id: 'id-123',
        client_secret: 'secret-456',
      });
    });

    it('自定义渠道 params 为 undefined 时返回空字典', () => {
      const config: CustomChannelConfig = {
        name: 'custom',
        type: 'custom',
        enable: true,
        params: [],
        uploadType: 'oss',
        objectKeyTemplate: '{fileName}',
        downloadUrlTemplate: 'https://example.com/{fileName}',
      };
      const params = TaskLauncher.getRawParams(config);
      expect(params).toEqual({});
    });
  });

  describe('injectConfig', () => {
    it('市场渠道注入解析后的参数', () => {
      const launcher = new TaskLauncher({
        channel: makeChannel(),
        channelConfig: makeChannelConfig(),
        apkPath: '/tmp/test.apk',
        enableChannel: true,
      });
      launcher.injectConfig({ client_id: 'resolved-id', client_secret: 'resolved-secret' });
      const config = launcher.getConfig();
      expect(config.client_id).toBe('resolved-id');
      expect(config.client_secret).toBe('resolved-secret');
      expect(config.fileNameIdentify).toBe('TEST');
    });

    it('自定义渠道保留完整配置', () => {
      const customConfig: CustomChannelConfig = {
        name: 'my-channel',
        type: 'custom',
        enable: true,
        params: [],
        uploadType: 'oss',
        objectKeyTemplate: '{fileName}',
        downloadUrlTemplate: 'https://example.com/{fileName}',
        endpoint: 'https://oss-cn-beijing.aliyuncs.com',
        bucket: 'my-bucket',
      };
      const launcher = new TaskLauncher({
        channel: makeChannel('my-channel'),
        channelConfig: customConfig,
        apkPath: '/tmp/test.apk',
        enableChannel: true,
      });
      launcher.injectConfig({ extra: 'value' });
      const config = launcher.getConfig();
      expect(config.endpoint).toBe('https://oss-cn-beijing.aliyuncs.com');
      expect(config.bucket).toBe('my-bucket');
      expect(config.extra).toBe('value');
    });
  });

  describe('getFilePath / getApkInfo', () => {
    it('未选择文件时 getFilePath 抛错', () => {
      const launcher = new TaskLauncher({
        channel: makeChannel(),
        channelConfig: makeChannelConfig(),
        apkPath: '/tmp/test.apk',
        enableChannel: true,
      });
      expect(() => launcher.getFilePath()).toThrow(ApkpubError);
    });

    it('未解析 APK 时 getApkInfo 抛错', () => {
      const launcher = new TaskLauncher({
        channel: makeChannel(),
        channelConfig: makeChannelConfig(),
        apkPath: '/tmp/test.apk',
        enableChannel: true,
      });
      expect(() => launcher.getApkInfo()).toThrow(ApkpubError);
    });
  });
});
