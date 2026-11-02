import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import nock from 'nock';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { honorChannel } from './index.js';
import type { UploadContext } from '../Channel.js';
import { ApkpubError } from '../../errors/ApkpubError.js';

const API = 'https://appmarket-openapi-drcn.cloud.honor.com';
const IAM = 'https://iam.developer.honor.com';
const config = { client_id: 'cid', client_secret: 'csecret' };

let apkPath: string;

beforeAll(() => {
  apkPath = path.join(tmpdir(), `honor-${randomUUID()}.apk`);
  writeFileSync(apkPath, Buffer.from('fake apk content'));
});

afterAll(() => {
  rmSync(apkPath, { force: true });
});

afterEach(() => {
  nock.cleanAll();
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
  nock(IAM).post('/auth/token').reply(200, { access_token: 'tok-123' });
}

function mockAppId(pkg: string) {
  nock(API)
    .get('/openapi/v1/publish/get-app-id')
    .query(true)
    .reply(200, { code: 0, data: [{ appId: 'app-1', pkgName: pkg }] });
}

describe('honorChannel.getMarketState', () => {
  it('正常返回线上版本信息（线上版本取 get-app-detail.releaseInfo）', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockToken();
    mockAppId(pkg);
    nock(API)
      .get('/openapi/v1/publish/get-app-detail')
      .query(true)
      .reply(200, { code: 0, data: { releaseInfo: { versionCode: 77, versionName: '5.0.0' } } });
    nock(API)
      .get('/openapi/v1/publish/get-app-current-release')
      .query(true)
      .reply(200, { code: 0, data: { releaseId: 'rel-1', auditResult: 1, versionCode: 77, versionName: '5.0.0' } });

    const state = await honorChannel.getMarketState!(pkg, config);
    expect(state?.lastVersionCode).toBe(77);
    expect(state?.reviewState).toBe('online');
  });

  it('未提交草稿（releaseId 为 null）不算审核状态，版本基准用线上版本', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockToken();
    mockAppId(pkg);
    nock(API)
      .get('/openapi/v1/publish/get-app-detail')
      .query(true)
      .reply(200, { code: 0, data: { releaseInfo: { versionCode: 70, versionName: '1.1.70' } } });
    nock(API)
      .get('/openapi/v1/publish/get-app-current-release')
      .query(true)
      .reply(200, { code: 0, data: { releaseId: null, auditResult: 0, versionCode: 77, versionName: '1.1.77' } });

    const state = await honorChannel.getMarketState!(pkg, config);
    expect(state?.reviewState).toBe('unknown');
    expect(state?.lastVersionCode).toBe(70);
    expect(state?.lastVersionName).toBe('1.1.70');
  });

  it('查询业务码非 0 抛错', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockToken();
    mockAppId(pkg);
    nock(API)
      .get('/openapi/v1/publish/get-app-detail')
      .query(true)
      .reply(200, { code: 0, data: { releaseInfo: { versionCode: 70, versionName: '1.1.70' } } });
    nock(API)
      .get('/openapi/v1/publish/get-app-current-release')
      .query(true)
      .reply(200, { code: 500, message: '服务异常' });

    await expect(honorChannel.getMarketState!(pkg, config)).rejects.toBeInstanceOf(ApkpubError);
  });
});

describe('honorChannel.upload', () => {
  function mockUploadUntilSubmit(pkg: string) {
    mockToken();
    mockAppId(pkg);
    nock(API)
      .get('/openapi/v1/publish/get-app-detail')
      .query(true)
      .reply(200, { code: 0, data: { languageInfo: [{ appName: 'App', intro: 'i', briefIntro: 'b' }] } });
    nock(API)
      .post('/openapi/v1/publish/get-file-upload-url')
      .query(true)
      .reply(200, { code: 0, data: [{ uploadUrl: `${API}/upload/obs`, objectId: 'obj-1' }] });
    nock(API)
      .post('/upload/obs')
      .matchHeader('content-length', (v: string) => Number(v) > 0)
      .reply(200, { code: 0 });
    nock(API)
      .post('/openapi/v1/publish/update-file-info', (body: { bindingFileList?: Array<Record<string, unknown>> }) => {
        // 绑定 APK 的字段名必须是 bindingFileList（对照 laiBao HonorBindApkFile.kt），
        // 否则荣耀返回 code 0 但未绑定，submit 报 30036 APK file not bound
        return body?.bindingFileList?.[0]?.objectId === 'obj-1';
      })
      .query(true)
      .reply(200, { code: 0 });
    nock(API)
      .post('/openapi/v1/publish/update-language-info', (body: { languageInfoList?: Array<Record<string, unknown>> }) => {
        // 荣耀要求更新说明字段名为 newFeature，并携带 languageId（对照 laiBao HonorVersionDesc.kt）
        const info = body?.languageInfoList?.[0];
        return info?.newFeature === '更新说明' && info?.languageId === 'zh-CN';
      })
      .query(true)
      .reply(200, { code: 0 });
  }

  it('完整链路提交成功', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockUploadUntilSubmit(pkg);
    nock(API).post('/openapi/v1/publish/submit-audit').query(true).reply(200, { code: 0 });

    const result = await honorChannel.upload(makeCtx(pkg));
    expect(result.message).toContain('成功');
  });

  it('提交审核业务码非 0 时抛错（校验补齐后不再静默成功）', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockUploadUntilSubmit(pkg);
    nock(API).post('/openapi/v1/publish/submit-audit').query(true).reply(200, { code: 40001, message: '提交失败' });

    await expect(honorChannel.upload(makeCtx(pkg))).rejects.toBeInstanceOf(ApkpubError);
  });

  it('上传文件 code 非 0 时抛错', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockToken();
    mockAppId(pkg);
    nock(API)
      .get('/openapi/v1/publish/get-app-detail')
      .query(true)
      .reply(200, { code: 0, data: { languageInfo: [{ appName: 'App' }] } });
    nock(API)
      .post('/openapi/v1/publish/get-file-upload-url')
      .query(true)
      .reply(200, { code: 0, data: [{ uploadUrl: `${API}/upload/obs`, objectId: 'obj-1' }] });
    nock(API).post('/upload/obs').reply(200, { code: 1, message: '上传失败' });

    await expect(honorChannel.upload(makeCtx(pkg))).rejects.toBeInstanceOf(ApkpubError);
  });
});
