import { describe, it, expect } from 'vitest';
import { configToFormModel, formModelToConfig } from './configUi.js';
import { CURRENT_SCHEMA_VERSION, type AppConfig } from '../config/schema.js';

/** 构造一份包含市场渠道与自定义渠道的完整配置 */
function fullConfig(): AppConfig {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: '示例应用',
    applicationId: 'com.example.app',
    createTime: 1700000000000,
    enableChannel: true,
    channels: [
      {
        name: 'honor',
        type: 'market',
        enable: true,
        params: [
          { name: 'client_id', value: 'id-123' },
          { name: 'client_secret', value: 'secret-xyz' },
          { name: 'fileNameIdentify', value: 'HONOR' },
        ],
      },
      {
        name: 'my-oss',
        type: 'custom',
        enable: false,
        uploadType: 'oss',
        fileNameIdentify: 'OSS',
        endpoint: 'oss-cn-hangzhou.aliyuncs.com',
        bucket: 'my-bucket',
        auth: { mode: 'ak', accessKeyId: 'AKID', accessKeySecret: 'AKSECRET' },
        objectKeyTemplate: 'apps/{appId}/{fileName}',
        downloadUrlTemplate: 'https://cdn.example.com/{fileName}',
        headers: { 'X-Token': 'abc' },
        params: [{ name: 'extra', value: 'v' }],
      },
    ],
    extension: {
      updateDesc: '版本更新说明',
      apkDir: '/tmp/apks',
      urls: { honor: 'https://developer.honor.com' },
      lastVersionCode: { honor: 100 },
      lastVersionName: { honor: '1.0.0' },
    },
  };
}

describe('configToFormModel / formModelToConfig', () => {
  it('往返转换应保持配置等价', () => {
    const config = fullConfig();
    const model = configToFormModel(config);
    const restored = formModelToConfig(model, config);
    expect(restored).toEqual(config);
  });

  it('应保留原配置的不可变字段（applicationId / createTime）', () => {
    const config = fullConfig();
    const model = configToFormModel(config);
    model.name = '改名后';
    const restored = formModelToConfig(model, config);
    expect(restored.applicationId).toBe(config.applicationId);
    expect(restored.createTime).toBe(config.createTime);
    expect(restored.name).toBe('改名后');
  });

  it('应过滤空参数名并保留密钥原文', () => {
    const config = fullConfig();
    const model = configToFormModel(config);
    (model.channels[0] as { params: { name: string; value: string }[] }).params.push({ name: '', value: '空' });
    const restored = formModelToConfig(model, config);
    const honor = restored.channels[0];
    expect('params' in honor && honor.params.some((p) => p.name === '')).toBe(false);
    expect('params' in honor && honor.params.find((p) => p.name === 'client_secret')?.value).toBe('secret-xyz');
  });

  it('未启用鉴权时应移除 auth 字段', () => {
    const config = fullConfig();
    const model = configToFormModel(config);
    const custom = model.channels[1];
    if (custom.type === 'custom') custom.authEnabled = false;
    const restored = formModelToConfig(model, config);
    const ch = restored.channels[1];
    expect(ch.type === 'custom' && ch.auth).toBeUndefined();
  });

  it('lastVersionCode 非数字应抛错', () => {
    const config = fullConfig();
    const model = configToFormModel(config);
    model.extension.lastVersionCode = [{ key: 'honor', value: '非数字' }];
    expect(() => formModelToConfig(model, config)).toThrow();
  });

  it('重复渠道名应抛错', () => {
    const config = fullConfig();
    const model = configToFormModel(config);
    model.channels[1].name = 'honor';
    expect(() => formModelToConfig(model, config)).toThrow();
  });
});
