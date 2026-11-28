import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppConfig } from '../config/schema.js';
import type { Channel } from '../channels/Channel.js';
import { resolveChannels } from '../channels/registry.js';
import { queryMarketStatus, runDoctor } from './inspect.js';

vi.mock('../channels/registry.js', () => ({ resolveChannels: vi.fn() }));

const appConfig = {
  schemaVersion: 1,
  name: '示例',
  applicationId: 'com.example.app',
  createTime: 0,
  enableChannel: false,
  channels: [
    { name: 'ok', type: 'market', enable: true, params: [{ name: 'client_id', value: 'id' }] },
    { name: 'bad', type: 'market', enable: true, params: [] },
  ],
  extension: {},
} as AppConfig;

function makeChannel(name: string, extra: Partial<Channel> = {}): Channel {
  return {
    name,
    label: name,
    type: 'market',
    fileNameIdentify: name,
    credentialSchema: { parse: (v: unknown) => v } as never,
    upload: async () => ({}),
    ...extra,
  };
}

beforeEach(() => {
  vi.mocked(resolveChannels).mockReset();
});

describe('queryMarketStatus', () => {
  it('单渠道失败不影响其他渠道，并把解析后的配置传给渠道', async () => {
    const okState = vi.fn(async () => ({
      reviewState: 'online' as const,
      enableSubmit: true,
      lastVersionCode: 3,
      lastVersionName: '1.3',
    }));
    vi.mocked(resolveChannels).mockReturnValue([
      makeChannel('ok', { getMarketState: okState }),
      makeChannel('bad', {
        getMarketState: async () => {
          throw new Error('网络错误');
        },
      }),
      makeChannel('custom', { type: 'custom' }),
    ]);
    const results = await queryMarketStatus(
      {
        ...appConfig,
        channels: [...appConfig.channels, { name: 'custom', type: 'market', enable: true, params: [] }],
      } as AppConfig,
    );
    expect(results).toEqual([
      expect.objectContaining({ name: 'ok', ok: true, state: expect.objectContaining({ lastVersionCode: 3 }) }),
      expect.objectContaining({ name: 'bad', ok: false, error: { code: 'INTERNAL', message: '网络错误' } }),
      expect.objectContaining({ name: 'custom', ok: true, unsupported: true }),
    ]);
    expect(okState).toHaveBeenCalledWith('com.example.app', expect.objectContaining({ client_id: 'id' }), {
      signal: undefined,
    });
  });
});

describe('queryMarketStatus 并发', () => {
  it('各渠道并发查询，结果保持渠道顺序', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = (name: string) =>
      makeChannel(name, {
        getMarketState: async () => {
          started.push(name);
          await gate;
          return { reviewState: 'online' as const, enableSubmit: true, lastVersionCode: 1, lastVersionName: '1' };
        },
      });
    vi.mocked(resolveChannels).mockReturnValue([slow('ok'), slow('bad')]);
    const pending = queryMarketStatus(appConfig);
    // 第一个渠道尚未返回时，第二个渠道已开始查询
    await vi.waitFor(() => expect([...started].sort()).toEqual(['bad', 'ok']));
    release();
    expect((await pending).map((r) => r.name)).toEqual(['ok', 'bad']);
  });
});

describe('runDoctor', () => {
  it('逐渠道汇总凭证预检结果', async () => {
    vi.mocked(resolveChannels).mockReturnValue([
      makeChannel('ok', { validateCredentials: async () => {} }),
      makeChannel('bad', {
        validateCredentials: async () => {
          throw new Error('凭证无效');
        },
      }),
    ]);
    const results = await runDoctor(appConfig);
    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ['ok', true],
      ['bad', false],
    ]);
    expect(results[1].error?.message).toBe('凭证无效');
  });
});
