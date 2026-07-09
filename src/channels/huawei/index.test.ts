import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import nock from 'nock';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { huaweiChannel } from './index.js';
import type { UploadContext } from '../Channel.js';
import { ApkpubError } from '../../errors/ApkpubError.js';

const HOST = 'https://connect-api.cloud.huawei.com';
const config = { client_id: 'cid', client_secret: 'csecret' };

let apkPath: string;

beforeAll(() => {
  apkPath = path.join(tmpdir(), `huawei-${randomUUID()}.apk`);
  writeFileSync(apkPath, Buffer.from('fake apk content'));
});

afterAll(() => {
  rmSync(apkPath, { force: true });
});

afterEach(() => {
  nock.cleanAll();
  vi.useRealTimers();
});

function makeCtx(pkg: string): UploadContext {
  return {
    apkInfo: { filePath: apkPath, applicationId: pkg, versionCode: 100, versionName: '1.0.0', size: 16 },
    filePath: apkPath,
    desc: '更新说明',
    config,
    onProgress: () => {},
    signal: new AbortController().signal,
  };
}

function mockToken() {
  nock(HOST).post('/api/oauth2/v1/token').reply(200, { access_token: 'tok-123' });
}

function mockAppId() {
  nock(HOST).get('/api/publish/v2/appid-list').query(true).reply(200, { appids: [{ value: 'hwid-1' }] });
}

describe('huaweiChannel.getMarketState', () => {
  it.each([
    [0, 'online'],
    [7, 'online'],
    [4, 'reviewing'],
    [5, 'reviewing'],
    [1, 'rejected'],
    [8, 'rejected'],
    [3, 'unknown'],
    [6, 'unknown'],
    [9, 'unknown'],
    [2, 'unknown'],
  ])('releaseState=%s 映射为 %s', async (releaseState, expected) => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockToken();
    mockAppId();
    nock(HOST)
      .get('/api/publish/v2/app-info')
      .query(true)
      .reply(200, { appInfo: { releaseState, versionCode: 99, versionNumber: '6.0.0' } });

    const state = await huaweiChannel.getMarketState!(pkg, config);
    expect(state?.reviewState).toBe(expected);
    expect(state?.lastVersionCode).toBe(99);
  });

  it('token 缺失时抛鉴权错误', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    nock(HOST).post('/api/oauth2/v1/token').reply(200, { error: 'invalid' });
    await expect(huaweiChannel.getMarketState!(pkg, config)).rejects.toBeInstanceOf(ApkpubError);
  });
});

describe('huaweiChannel.upload', () => {
  // 走到 bindApk 前的链路（getUploadUrl 头部解析 + 带 Content-Length 上传），
  // 用空 pkgVersion 在 bindApk 处抛错收尾，避免触发 waitApkReady 的 10s 轮询等待。
  function mockUntilBind(headers: unknown, pkgVersion: unknown[]) {
    mockToken();
    mockAppId();
    nock(HOST)
      .get('/api/publish/v2/upload-url/for-obs')
      .query(true)
      .reply(200, { urlInfo: { url: `${HOST}/obs/put-object`, objectId: 'obj-1', headers } });
    nock(HOST)
      .put('/obs/put-object')
      .reply(function () {
        // 断言上传请求带上了 Content-Length 头
        expect(this.req.headers['content-length']).toBeDefined();
        return [200, {}];
      });
    nock(HOST).put('/api/publish/v2/app-file-info').query(true).reply(200, { pkgVersion });
  }

  it('headers 数组形态可正确解析并带 Content-Length 上传', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockUntilBind([{ key: 'X-Obs-Meta', value: 'v1' }], []);
    await expect(huaweiChannel.upload(makeCtx(pkg))).rejects.toBeInstanceOf(ApkpubError);
  });

  it('headers 对象形态可正确解析', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockUntilBind({ 'X-Obs-Meta': 'v1' }, []);
    await expect(huaweiChannel.upload(makeCtx(pkg))).rejects.toBeInstanceOf(ApkpubError);
  });

  it('完整链路提交成功（含编译轮询与提交校验）', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockToken();
    mockAppId();
    nock(HOST)
      .get('/api/publish/v2/upload-url/for-obs')
      .query(true)
      .reply(200, { urlInfo: { url: `${HOST}/obs/put-object`, objectId: 'obj-1' } });
    nock(HOST).put('/obs/put-object').reply(200, {});
    nock(HOST)
      .put('/api/publish/v2/app-file-info')
      .query(true)
      .reply(200, { pkgVersion: ['pkg-ver-1'] });
    nock(HOST)
      .get('/api/publish/v2/package/compile/status')
      .query(true)
      .reply(200, { ret: { code: 0 }, pkgStateList: [{ pkgId: 'pkg-ver-1', successStatus: 0 }] });
    nock(HOST).put('/api/publish/v2/app-language-info').query(true).reply(200, { ret: { code: 0 } });
    nock(HOST).post('/api/publish/v2/app-submit').query(true).reply(200, { ret: { code: 0 } });

    const result = await huaweiChannel.upload(makeCtx(pkg));
    expect(result.message).toContain('成功');
  }, 20_000);
});
