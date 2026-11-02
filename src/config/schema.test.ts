import { describe, it, expect } from 'vitest';
import {
  migrateConfig,
  stripSecrets,
  paramsToRecord,
  CURRENT_SCHEMA_VERSION,
  type AppConfig,
} from './schema.js';

/** 构造一份基础应用配置 */
function baseConfig(): AppConfig {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: '示例应用',
    applicationId: 'com.example.app',
    createTime: 1700000000000,
    enableChannel: true,
    channels: [
      {
        name: 'huawei',
        type: 'market',
        enable: true,
        params: [
          { name: 'client_id', value: 'public-id' },
          { name: 'client_secret', value: 'top-secret' },
        ],
      },
    ],
    extension: {},
  };
}

describe('paramsToRecord', () => {
  it('应将参数数组转为字典', () => {
    const record = paramsToRecord([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]);
    expect(record).toEqual({ a: '1', b: '2' });
  });
});

describe('migrateConfig', () => {
  it('应为缺失 schemaVersion 的旧配置补默认版本', () => {
    const raw = {
      name: '旧应用',
      applicationId: 'com.old.app',
      createTime: 1,
      channels: [],
    };
    const migrated = migrateConfig(raw);
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.applicationId).toBe('com.old.app');
  });

  it('应填充缺省字段', () => {
    const migrated = migrateConfig({
      name: 'app',
      applicationId: 'com.x',
      createTime: 1,
    });
    expect(migrated.enableChannel).toBe(true);
    expect(migrated.channels).toEqual([]);
    expect(migrated.extension).toEqual({});
  });

  it('非法配置应抛出校验错误', () => {
    expect(() => migrateConfig({ name: 'x' })).toThrow();
  });
});

describe('stripSecrets', () => {
  it('应清空市场渠道参数中的敏感字段', () => {
    const stripped = stripSecrets(baseConfig());
    const params = paramsToRecord(
      'params' in stripped.channels[0] ? stripped.channels[0].params : [],
    );
    expect(params.client_id).toBe('public-id');
    expect(params.client_secret).toBe('');
  });

  it('应清空自定义渠道 OSS 的 AK 凭证', () => {
    const config: AppConfig = {
      ...baseConfig(),
      channels: [
        {
          name: 'my-oss',
          type: 'custom',
          enable: true,
          uploadType: 'oss',
          objectKeyTemplate: 'apps/{appId}/{fileName}',
          downloadUrlTemplate: 'https://cdn.example.com/{fileName}',
          auth: {
            mode: 'ak',
            accessKeyId: 'AKID',
            accessKeySecret: 'AKSECRET',
          },
          params: [],
        },
      ],
    };
    const stripped = stripSecrets(config);
    const ch = stripped.channels[0];
    expect(ch.type).toBe('custom');
    if (ch.type === 'custom' && ch.auth?.mode === 'ak') {
      expect(ch.auth.accessKeyId).toBe('');
      expect(ch.auth.accessKeySecret).toBe('');
    }
  });

  it('应清空 VIVO access_secret 与小米 privateKey，保留非敏感字段', () => {
    const config: AppConfig = {
      ...baseConfig(),
      channels: [
        {
          name: 'vivo',
          type: 'market',
          enable: true,
          params: [
            { name: 'access_key', value: 'vivo-ak' },
            { name: 'access_secret', value: 'vivo-secret' },
          ],
        },
        {
          name: 'mi',
          type: 'market',
          enable: true,
          params: [
            { name: 'account', value: 'dev@example.com' },
            { name: 'publicKey', value: 'PUB' },
            { name: 'privateKey', value: 'PRIV' },
          ],
        },
      ],
    };
    const stripped = stripSecrets(config);
    const vivo = paramsToRecord('params' in stripped.channels[0] ? stripped.channels[0].params : []);
    const mi = paramsToRecord('params' in stripped.channels[1] ? stripped.channels[1].params : []);
    expect(vivo).toEqual({ access_key: 'vivo-ak', access_secret: '' });
    expect(mi).toEqual({ account: 'dev@example.com', publicKey: 'PUB', privateKey: '' });
  });

  it('应清空自定义渠道 headers 中的敏感值', () => {
    const config: AppConfig = {
      ...baseConfig(),
      channels: [
        {
          name: 'my-http',
          type: 'custom',
          enable: true,
          uploadType: 'http',
          uploadUrl: 'https://upload.example.com',
          objectKeyTemplate: '{fileName}',
          downloadUrlTemplate: 'https://cdn.example.com/{fileName}',
          headers: { Authorization: 'Bearer abc', 'X-Api-Key': 'k', 'X-Trace': 't' },
          params: [],
        },
      ],
    };
    const ch = stripSecrets(config).channels[0];
    expect(ch.type === 'custom' && ch.headers).toEqual({ Authorization: '', 'X-Api-Key': '', 'X-Trace': 't' });
  });

  it('不应修改原始配置对象', () => {
    const config = baseConfig();
    stripSecrets(config);
    const params = paramsToRecord('params' in config.channels[0] ? config.channels[0].params : []);
    expect(params.client_secret).toBe('top-secret');
  });
});
