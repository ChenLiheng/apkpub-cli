import { describe, expect, it } from 'vitest';
import { buildDescriptor } from './descriptor.js';
import { PACKAGE_VERSION } from '../version.js';

describe('buildDescriptor', () => {
  it('输出实际版本、Agent 工作流和新增 publish 参数', () => {
    const descriptor = buildDescriptor() as {
      version: string;
      agentWorkflow: string[];
      commands: { name: string; options: { name: string }[] }[];
      channels: { name: string; credentialFields: { name: string; env?: string }[] }[];
    };
    const publish = descriptor.commands.find((command) => command.name === 'publish');

    expect(descriptor.version).toBe(PACKAGE_VERSION);
    expect(descriptor.agentWorkflow.length).toBeGreaterThan(0);
    expect(publish?.options.map((option) => option.name)).toEqual(expect.arrayContaining([
      '--yes',
      '--no-progress',
      '--debug',
    ]));
  });

  it('渠道凭证字段包含默认环境变量名', () => {
    const descriptor = buildDescriptor() as {
      channels: { name: string; credentialFields: { name: string; env?: string }[] }[];
    };
    const huawei = descriptor.channels.find((channel) => channel.name === 'huawei');
    expect(huawei?.credentialFields).toContainEqual(expect.objectContaining({
      name: 'client_secret',
      env: 'HUAWEI_CLIENT_SECRET',
    }));
  });
});
