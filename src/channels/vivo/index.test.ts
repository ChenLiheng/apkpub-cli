import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import nock from 'nock';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { vivoChannel } from './index.js';
import type { UploadContext } from '../Channel.js';
import { ApkpubError } from '../../errors/ApkpubError.js';

const HOST = 'https://developer-api.vivo.com.cn';
const config = { access_key: 'ak', access_secret: 'sk' };

let apkPath: string;

beforeAll(() => {
  apkPath = path.join(tmpdir(), `vivo-${randomUUID()}.apk`);
  writeFileSync(apkPath, Buffer.from('fake apk content'));
});

afterAll(() => {
  rmSync(apkPath, { force: true });
});

afterEach(() => {
  nock.cleanAll();
});

function byMethod(method: string) {
  return (q: NodeJS.Dict<string | string[]>) => q.method === method;
}

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

describe('vivoChannel.getMarketState', () => {
  it('正常返回线上版本信息', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    nock(HOST)
      .get('/router/rest')
      .query(byMethod('app.query.details'))
      .reply(200, { code: 0, subCode: 0, data: { versionCode: 88, versionName: '2.1.0', onlineType: 1 } });

    const state = await vivoChannel.getMarketState!(pkg, config);
    expect(state?.lastVersionCode).toBe(88);
    expect(state?.lastVersionName).toBe('2.1.0');
    expect(state?.reviewState).toBe('online');
  });

  it('业务码非 0 抛出 ApkpubError', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    nock(HOST)
      .get('/router/rest')
      .query(byMethod('app.query.details'))
      .reply(200, { code: 10001, subCode: 10001, msg: '鉴权失败' });

    await expect(vivoChannel.getMarketState!(pkg, config)).rejects.toBeInstanceOf(ApkpubError);
  });
});

describe('vivoChannel.upload', () => {
  it('完整链路提交成功', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    nock(HOST)
      .get('/router/rest')
      .query(byMethod('app.query.details'))
      .reply(200, { code: 0, subCode: 0, data: { versionCode: 88, versionName: '2.1.0', onlineType: 2 } });
    nock(HOST)
      .post('/router/rest')
      .query(byMethod('app.upload.apk.app'))
      .reply(200, {
        code: 0,
        subCode: 0,
        data: { packageName: pkg, versionCode: 100, serialnumber: 'sn-123', fileMd5: 'md5abc' },
      });
    nock(HOST)
      .get('/router/rest')
      .query(byMethod('app.sync.update.app'))
      .reply(200, { code: 0, subCode: 0 });

    const result = await vivoChannel.upload(makeCtx(pkg));
    expect(result.message).toContain('成功');
  });

  it('上传接口业务码非 0 时抛错', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    nock(HOST)
      .get('/router/rest')
      .query(byMethod('app.query.details'))
      .reply(200, { code: 0, subCode: 0, data: { versionCode: 88, versionName: '2.1.0', onlineType: 1 } });
    nock(HOST)
      .post('/router/rest')
      .query(byMethod('app.upload.apk.app'))
      .reply(200, { code: 20001, subCode: 20001, msg: '上传失败' });

    await expect(vivoChannel.upload(makeCtx(pkg))).rejects.toBeInstanceOf(ApkpubError);
  });
});
