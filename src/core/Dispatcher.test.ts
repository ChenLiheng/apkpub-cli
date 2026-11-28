import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Channel } from '../channels/Channel.js';
import type { AppConfig } from '../config/schema.js';
import { parseApk } from '../apk/ApkParser.js';
import { writeAuditLog } from '../config/store.js';
import { Dispatcher } from './Dispatcher.js';

vi.mock('../apk/ApkParser.js', () => ({ parseApk: vi.fn() }));
vi.mock('../config/store.js', () => ({ writeAuditLog: vi.fn() }));

const APP_ID = 'com.example.app';
let apkPath: string;

beforeAll(() => {
  apkPath = path.join(tmpdir(), `dispatcher-${randomUUID()}.apk`);
  writeFileSync(apkPath, Buffer.from('fake apk'));
});

afterAll(() => {
  rmSync(apkPath, { force: true });
});

beforeEach(() => {
  vi.mocked(parseApk).mockReset().mockResolvedValue({
    filePath: apkPath,
    applicationId: APP_ID,
    versionCode: 2,
    versionName: '1.1',
    size: 8,
  });
  vi.mocked(writeAuditLog).mockReset().mockResolvedValue(undefined);
});

function makeChannel(name: string, upload: Channel['upload'] = async () => ({ message: 'ok' })): Channel {
  return {
    name,
    label: name,
    type: 'market',
    fileNameIdentify: name.toUpperCase(),
    credentialSchema: { parse: (v: unknown) => v } as never,
    upload,
  };
}

function makeAppConfig(names: string[]): AppConfig {
  return {
    schemaVersion: 1,
    name: '示例',
    applicationId: APP_ID,
    createTime: 0,
    enableChannel: false,
    channels: names.map((name) => ({ name, type: 'market' as const, enable: true, params: [] })),
    extension: {},
  } as AppConfig;
}

describe('Dispatcher', () => {
  it('上传成功后审计日志写入失败，渠道仍记为成功', async () => {
    vi.mocked(writeAuditLog).mockRejectedValue(new Error('EACCES'));
    const result = await new Dispatcher().dispatch({
      appConfig: makeAppConfig(['a']),
      channels: [makeChannel('a')],
      apkPath,
      updateDesc: '更新',
    });
    expect(result.results[0].status).toBe('success');
    expect(result.ok).toBe(true);
  });

  it('上传失败时审计日志写入失败不掩盖原始错误', async () => {
    vi.mocked(writeAuditLog).mockRejectedValue(new Error('EACCES'));
    const result = await new Dispatcher().dispatch({
      appConfig: makeAppConfig(['a']),
      channels: [
        makeChannel('a', async () => {
          throw new Error('上传炸了');
        }),
      ],
      apkPath,
      updateDesc: '更新',
    });
    expect(result.results[0]).toMatchObject({ status: 'failed', error: { message: '上传炸了' } });
  });

  it('单文件发布到多个渠道时 APK 只解析一次', async () => {
    const result = await new Dispatcher().dispatch({
      appConfig: makeAppConfig(['a', 'b', 'c']),
      channels: [makeChannel('a'), makeChannel('b'), makeChannel('c')],
      apkPath,
      updateDesc: '更新',
      parallel: 3,
    });
    expect(result.summary.success).toBe(3);
    expect(parseApk).toHaveBeenCalledTimes(1);
  });

  it('每个渠道拿到独立的 ApkInfo 副本', async () => {
    const seen: unknown[] = [];
    const record: Channel['upload'] = async (ctx) => {
      seen.push(ctx.apkInfo);
      return { message: 'ok' };
    };
    await new Dispatcher().dispatch({
      appConfig: makeAppConfig(['a', 'b']),
      channels: [makeChannel('a', record), makeChannel('b', record)],
      apkPath,
      updateDesc: '更新',
      parallel: 2,
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[0]).toEqual(seen[1]);
  });

  it('信号已取消时不调用上传', async () => {
    const upload = vi.fn(async () => ({ message: 'ok' }));
    const controller = new AbortController();
    controller.abort();
    const result = await new Dispatcher().dispatch({
      appConfig: makeAppConfig(['a']),
      channels: [makeChannel('a', upload)],
      apkPath,
      updateDesc: '更新',
      signal: controller.signal,
    });
    expect(upload).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({ status: 'failed', error: { code: 'TIMEOUT' } });
  });

  it('把取消信号传给 getMarketState', async () => {
    const getMarketState = vi.fn(async () => ({
      reviewState: 'online' as const,
      enableSubmit: true,
      lastVersionCode: 1,
      lastVersionName: '1.0',
    }));
    const controller = new AbortController();
    await new Dispatcher().dispatch({
      appConfig: makeAppConfig(['a']),
      channels: [{ ...makeChannel('a'), getMarketState }],
      apkPath,
      updateDesc: '更新',
      signal: controller.signal,
    });
    expect(getMarketState).toHaveBeenCalledWith(APP_ID, expect.any(Object), { signal: controller.signal });
  });
});
