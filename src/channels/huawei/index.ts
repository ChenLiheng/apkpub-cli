import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { Channel, MarketInfo, UploadContext } from '../Channel.js';
import { createHttpClient, withRetry } from '../../utils/http.js';
import { ApkpubError, ErrorCode } from '../../errors/ApkpubError.js';

const BASE_URL = 'https://connect-api.cloud.huawei.com';

const credSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  const client = createHttpClient();
  const resp = await client.post(`${BASE_URL}/api/oauth2/v1/token`, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  if (resp.data?.access_token) return resp.data.access_token as string;
  throw new ApkpubError({
    code: ErrorCode.CHANNEL_AUTH_FAILED,
    channel: 'huawei',
    step: 'getToken',
    message: `获取 token 失败: ${JSON.stringify(resp.data)}`,
    retryable: false,
  });
}

async function getAppId(clientId: string, token: string, packageName: string): Promise<string> {
  const client = createHttpClient();
  const resp = await client.get(`${BASE_URL}/api/publish/v2/appid-list`, {
    headers: { client_id: clientId, Authorization: `Bearer ${token}` },
    params: { packageName },
  });
  const list = resp.data?.appids ?? resp.data?.list ?? [];
  if (!list.length) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_STATE_FAILED,
      channel: 'huawei',
      step: 'getAppId',
      message: `未找到包名 ${packageName} 对应的应用`,
      retryable: false,
    });
  }
  return list[0].value ?? list[0].id ?? list[0].appId;
}

async function getUploadUrl(
  clientId: string,
  token: string,
  appId: string,
  fileName: string,
  contentLength: number,
): Promise<{ url: string; objectId: string; headers: Record<string, string> }> {
  const client = createHttpClient();
  const resp = await client.get(`${BASE_URL}/api/publish/v2/upload-url/for-obs`, {
    headers: { client_id: clientId, Authorization: `Bearer ${token}` },
    params: { appId, fileName, contentLength },
  });
  const urlInfo = resp.data?.urlInfo ?? resp.data?.url;
  if (!urlInfo?.url) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      channel: 'huawei',
      step: 'getUploadUrl',
      message: `获取上传地址失败: ${JSON.stringify(resp.data)}`,
      retryable: true,
    });
  }
  const headers: Record<string, string> = {};
  if (urlInfo.headers) {
    if (Array.isArray(urlInfo.headers)) {
      for (const h of urlInfo.headers) {
        headers[h.key ?? h.name] = h.value;
      }
    } else {
      Object.assign(headers, urlInfo.headers);
    }
  }
  return { url: urlInfo.url, objectId: urlInfo.objectId, headers };
}

async function uploadFile(
  uploadUrl: string,
  headers: Record<string, string>,
  filePath: string,
  onProgress: (p: number) => void,
): Promise<void> {
  const client = createHttpClient({ timeout: 600_000 });
  // 以流方式上传避免大 APK 整包读入内存；显式带 Content-Length 满足 OBS 预签名 PUT 的长度校验
  const contentLength = fs.statSync(filePath).size;
  const stream = fs.createReadStream(filePath);
  const resp = await client.put(uploadUrl, stream, {
    headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(contentLength) },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    onUploadProgress: (e) => {
      const total = e.total ?? contentLength;
      if (total) onProgress(Math.round((e.loaded / total) * 100));
    },
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      channel: 'huawei',
      step: 'uploadFile',
      message: `上传失败 HTTP ${resp.status}`,
      retryable: resp.status >= 500,
    });
  }
}

async function bindApk(
  clientId: string,
  token: string,
  appId: string,
  fileName: string,
  objectId: string,
): Promise<{ pkgId: string }> {
  const client = createHttpClient();
  const resp = await client.put(
    `${BASE_URL}/api/publish/v2/app-file-info`,
    { fileType: 5, files: [{ fileName, fileDestUrl: objectId }] },
    { headers: { client_id: clientId, Authorization: `Bearer ${token}` }, params: { appId } },
  );
  const pkgId = resp.data?.pkgVersion?.[0] ?? resp.data?.pkgId;
  if (!pkgId) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      channel: 'huawei',
      step: 'bindApk',
      message: `绑定 APK 失败: ${JSON.stringify(resp.data)}`,
      retryable: false,
    });
  }
  return { pkgId };
}

async function waitApkReady(
  clientId: string,
  token: string,
  appId: string,
  pkgId: string,
  signal: AbortSignal,
): Promise<void> {
  const client = createHttpClient();
  const start = Date.now();
  const timeout = 3 * 60 * 1000;
  while (Date.now() - start < timeout) {
    if (signal.aborted) throw new ApkpubError({ code: ErrorCode.TIMEOUT, message: '等待编译超时', retryable: false });
    await new Promise((r) => setTimeout(r, 10_000));
    const resp = await client.get(`${BASE_URL}/api/publish/v2/package/compile/status`, {
      headers: { client_id: clientId, Authorization: `Bearer ${token}` },
      params: { appId, pkgIds: pkgId },
    });
    const state = resp.data?.pkgStateList?.[0]?.pkgState ?? resp.data?.compileStatus;
    if (state === 0 || state === 'COMPILE_SUCCESS') return;
  }
  throw new ApkpubError({
    code: ErrorCode.TIMEOUT,
    channel: 'huawei',
    step: 'waitApkReady',
    message: '等待 APK 编译超时',
    retryable: true,
  });
}

export const huaweiChannel: Channel = {
  name: 'huawei',
  label: '华为',
  type: 'market',
  fileNameIdentify: 'HUAWEI',
  credentialSchema: credSchema,
  async getMarketState(appId, config) {
    const creds = credSchema.parse(config);
    const token = await getToken(creds.client_id, creds.client_secret);
    const hwAppId = await getAppId(creds.client_id, token, appId);
    const client = createHttpClient();
    const resp = await client.get(`${BASE_URL}/api/publish/v2/app-info`, {
      headers: { client_id: creds.client_id, Authorization: `Bearer ${token}` },
      params: { appId: hwAppId },
    });
    const info = resp.data?.appInfo ?? resp.data;
    const reviewState = mapReviewState(info?.releaseState ?? info?.status);
    return {
      reviewState,
      enableSubmit: reviewState === 'online' || reviewState === 'rejected',
      lastVersionCode: Number(info?.versionCode ?? 0),
      lastVersionName: String(info?.versionNumber ?? info?.onShelfVersionNumber ?? info?.versionName ?? '0'),
    };
  },
  async validateCredentials(config) {
    const creds = credSchema.parse(config);
    await getToken(creds.client_id, creds.client_secret);
  },
  async upload(ctx: UploadContext) {
    const creds = credSchema.parse(ctx.config);
    const fileName = path.basename(ctx.filePath);
    ctx.onProgress({ step: 'getToken' });
    const token = await withRetry(() => getToken(creds.client_id, creds.client_secret));
    ctx.onProgress({ step: 'getAppId' });
    const appId = await getAppId(creds.client_id, token, ctx.apkInfo.applicationId);
    ctx.onProgress({ step: 'getUploadUrl' });
    const uploadInfo = await getUploadUrl(creds.client_id, token, appId, fileName, ctx.apkInfo.size);
    ctx.onProgress({ step: 'uploading', percent: 0 });
    await uploadFile(uploadInfo.url, uploadInfo.headers, ctx.filePath, (p) =>
      ctx.onProgress({ step: 'uploading', percent: p }),
    );
    ctx.onProgress({ step: 'bindApk' });
    const bind = await bindApk(creds.client_id, token, appId, fileName, uploadInfo.objectId);
    ctx.onProgress({ step: 'waitCompile' });
    await waitApkReady(creds.client_id, token, appId, bind.pkgId, ctx.signal);
    ctx.onProgress({ step: 'updateDesc' });
    const client = createHttpClient();
    await client.put(
      `${BASE_URL}/api/publish/v2/app-language-info`,
      { lang: 'zh-CN', appDesc: ctx.desc },
      { headers: { client_id: creds.client_id, Authorization: `Bearer ${token}` }, params: { appId } },
    );
    ctx.onProgress({ step: 'submit' });
    await client.post(`${BASE_URL}/api/publish/v2/app-submit`, null, {
      headers: { client_id: creds.client_id, Authorization: `Bearer ${token}` },
      params: { appId },
    });
    ctx.onProgress({ step: 'done', percent: 100 });
    return { message: '提交审核成功' };
  },
};

function mapReviewState(state: unknown): MarketInfo['reviewState'] {
  const s = Number(state);
  if (s === 0 || s === 7) return 'online';        // 已上架 / 草稿
  if (s === 4 || s === 5) return 'reviewing';      // 审核中 / 升级中
  if (s === 1 || s === 8 || s === 9) return 'rejected'; // 审核不通过
  return 'unknown';                                 // 已下架(2) / 开发者下架(10) 等
}
