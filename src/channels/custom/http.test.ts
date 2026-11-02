import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import nock from 'nock';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { uploadToHttp } from './http.js';
import type { UploadContext } from '../Channel.js';
import type { CustomChannelConfig } from '../../config/schema.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const content = Buffer.from('fake apk content for http upload');
let apkPath: string;

beforeAll(() => {
  apkPath = path.join(tmpdir(), `http-${randomUUID()}.apk`);
  writeFileSync(apkPath, content);
});

afterAll(() => rmSync(apkPath, { force: true }));

afterEach(() => nock.cleanAll());

function makeCtx(signal = new AbortController().signal): UploadContext {
  return {
    apkInfo: { filePath: apkPath, applicationId: 'com.example.app', versionCode: 3, versionName: '1.2.0', size: content.length },
    filePath: apkPath,
    desc: 'desc',
    config: {},
    onProgress: () => {},
    signal,
  };
}

const config: CustomChannelConfig = {
  name: 'cdn',
  type: 'custom',
  enable: true,
  uploadType: 'http',
  uploadUrl: 'https://upload.example.com/{objectKey}',
  method: 'PUT',
  headers: { Authorization: 'Bearer resolved-token' },
  objectKeyTemplate: 'apps/{versionCode}/{fileName}',
  downloadUrlTemplate: 'https://cdn.example.com/{objectKey}',
  params: [],
};

describe('uploadToHttp', () => {
  it('PUT 以流方式上传并带上 Content-Length 与自定义 headers', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const fileName = path.basename(apkPath);
    let receivedBody = '';
    nock('https://upload.example.com', {
      reqheaders: {
        'content-length': String(content.length),
        authorization: 'Bearer resolved-token',
      },
    })
      .put(`/apps/3/${fileName}`, (body: string) => {
        receivedBody = body;
        return true;
      })
      .reply(200);

    const result = await uploadToHttp(makeCtx(), config);
    expect(receivedBody).toBe(content.toString());
    expect(result.downloadUrl).toBe(`https://cdn.example.com/apps/3/${fileName}`);
  });

  it('非 2xx 时抛出上传失败', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    nock('https://upload.example.com').put(/.*/).reply(403);
    await expect(uploadToHttp(makeCtx(), config)).rejects.toMatchObject({ code: 'CHANNEL_UPLOAD_FAILED', retryable: false });
  });
});
