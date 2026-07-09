import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import nock from 'nock';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { miChannel } from './index.js';
import type { UploadContext } from '../Channel.js';
import { ApkpubError } from '../../errors/ApkpubError.js';

const HOST = 'https://api.developer.xiaomi.com';
const BASE = '/devupload';

let apkPath: string;
let config: { account: string; publicKey: string; privateKey: string };

beforeAll(() => {
  apkPath = path.join(tmpdir(), `mi-${randomUUID()}.apk`);
  writeFileSync(apkPath, Buffer.from('fake apk content'));
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  config = { account: 'dev@test.com', publicKey, privateKey };
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

describe('miChannel.getMarketState', () => {
  it('正常返回线上版本信息', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    nock(HOST)
      .post(`${BASE}/dev/query`)
      .reply(200, { result: 0, packageInfo: { versionCode: 55, versionName: '4.0.0', appName: '测试应用' } });

    const state = await miChannel.getMarketState!(pkg, config);
    expect(state?.lastVersionCode).toBe(55);
    expect(state?.lastVersionName).toBe('4.0.0');
  });

  it('业务码非 0 抛出 ApkpubError', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    nock(HOST)
      .post(`${BASE}/dev/query`)
      .reply(200, { result: 1001, message: '鉴权失败' });

    await expect(miChannel.getMarketState!(pkg, config)).rejects.toBeInstanceOf(ApkpubError);
  });
});

describe('miChannel.upload', () => {
  it('完整链路提交成功', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    nock(HOST)
      .post(`${BASE}/dev/query`)
      .reply(200, { result: 0, packageInfo: { versionCode: 55, versionName: '4.0.0', appName: '测试应用' } });
    nock(HOST).post(`${BASE}/dev/push`).reply(200, { result: 0 });

    const result = await miChannel.upload(makeCtx(pkg));
    expect(result.message).toContain('成功');
  });

  it('上传接口业务码非 0 时抛错', async () => {
    const pkg = `com.test.${randomUUID().slice(0, 8)}`;
    nock(HOST)
      .post(`${BASE}/dev/query`)
      .reply(200, { result: 0, packageInfo: { versionCode: 55, versionName: '4.0.0', appName: '测试应用' } });
    nock(HOST).post(`${BASE}/dev/push`).reply(200, { result: 2002, message: '上传失败' });

    await expect(miChannel.upload(makeCtx(pkg))).rejects.toBeInstanceOf(ApkpubError);
  });
});
