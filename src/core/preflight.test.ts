import { describe, it, expect } from 'vitest';
import type { AppConfig } from '../config/schema.js';
import { ErrorCode } from '../errors/ApkpubError.js';
import { preparePublishInputs } from './preflight.js';

function makeAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    schemaVersion: 1,
    name: '示例',
    applicationId: 'com.example.app',
    createTime: 0,
    enableChannel: false,
    channels: [{ name: 'huawei', type: 'market', enable: true, params: [] }],
    extension: {},
    ...overrides,
  } as AppConfig;
}

describe('preparePublishInputs', () => {
  it('更新描述为空时抛 INVALID_ARGUMENT', () => {
    expect(() => preparePublishInputs(makeAppConfig(), { desc: '   ' })).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT }),
    );
  });

  it('未传描述时回退到配置中的默认描述并去除首尾空白', () => {
    const inputs = preparePublishInputs(makeAppConfig({ extension: { updateDesc: '  默认描述 ' } }), {});
    expect(inputs.updateDesc).toBe('默认描述');
    expect(inputs.channels.map((c) => c.name)).toEqual(['huawei']);
  });

  it('没有启用的渠道时抛 CHANNEL_NOT_FOUND', () => {
    const appConfig = makeAppConfig({
      channels: [{ name: 'huawei', type: 'market', enable: false, params: [] }],
    });
    expect(() => preparePublishInputs(appConfig, { desc: '更新' })).toThrow(
      expect.objectContaining({ code: ErrorCode.CHANNEL_NOT_FOUND }),
    );
  });
});
