import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import nock from 'nock';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { oppoChannel } from './index.js';
import type { UploadContext } from '../Channel.js';
import { ApkpubError } from '../../errors/ApkpubError.js';

const HOST = 'https://oop-openapi-cn.heytapmobi.com';
const config = { client_id: 'cid', client_secret: 'csecret' };

let apkPath: string;

beforeAll(() => {
  apkPath = path.join(tmpdir(), `oppo-${randomUUID()}.apk`);
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
  nock(HOST)
    .get('/developer/v1/token')
    .query(true)
    .reply(200, { errno: 0, data: { access_token: 'tok-123' } });
}

describe('oppoChannel.getMarketState', () => {
  it('正常返回线上版本信息，audit_status=111 映射为 online', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockToken();
    nock(HOST)
      .get('/resource/v1/app/info')
      .query(true)
      .reply(200, { errno: 0, data: { version_code: 66, version_name: '3.0.0', audit_status: 111 } });

    const state = await oppoChannel.getMarketState!(pkg, config);
    expect(state?.lastVersionCode).toBe(66);
    expect(state?.lastVersionName).toBe('3.0.0');
    expect(state?.reviewState).toBe('online');
  });

  it('audit_status 非 111 映射为 reviewing', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockToken();
    nock(HOST)
      .get('/resource/v1/app/info')
      .query(true)
      .reply(200, { errno: 0, data: { version_code: 66, version_name: '3.0.0', audit_status: 100 } });

    const state = await oppoChannel.getMarketState!(pkg, config);
    expect(state?.reviewState).toBe('reviewing');
  });

  it('token 业务码非 0 抛错', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    nock(HOST)
      .get('/developer/v1/token')
      .query(true)
      .reply(200, { errno: 10001, data: { message: '鉴权失败' } });

    await expect(oppoChannel.getMarketState!(pkg, config)).rejects.toBeInstanceOf(ApkpubError);
  });
});

describe('oppoChannel.upload', () => {
  it('完整链路提交成功', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockToken();
    nock(HOST)
      .get('/resource/v1/app/info')
      .query(true)
      .reply(200, { errno: 0, data: { second_category_id: 1, third_category_id: 2, summary: 's' } });
    nock(HOST)
      .get('/resource/v1/upload/get-upload-url')
      .query(true)
      .reply(200, { errno: 0, data: { upload_url: `${HOST}/resource/v1/upload/apk`, sign: 'sg' } });
    nock(HOST)
      .post('/resource/v1/upload/apk')
      .query(true)
      .reply(200, { errno: 0, data: { url: 'http://cdn/app.apk', md5: 'md5abc' } });
    nock(HOST)
      .post('/resource/v1/app/upd')
      .query(true)
      .reply(200, { errno: 0 });

    const result = await oppoChannel.upload(makeCtx(pkg));
    expect(result.message).toContain('成功');
  });

  it('上传接口业务码非 0 时抛错', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    mockToken();
    nock(HOST)
      .get('/resource/v1/app/info')
      .query(true)
      .reply(200, { errno: 0, data: {} });
    nock(HOST)
      .get('/resource/v1/upload/get-upload-url')
      .query(true)
      .reply(200, { errno: 0, data: { upload_url: `${HOST}/resource/v1/upload/apk`, sign: 'sg' } });
    nock(HOST)
      .post('/resource/v1/upload/apk')
      .query(true)
      .reply(200, { errno: 30001, data: { message: '上传失败' } });

    await expect(oppoChannel.upload(makeCtx(pkg))).rejects.toBeInstanceOf(ApkpubError);
  });
});
