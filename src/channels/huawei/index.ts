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

// 华为应用信息响应（宽松解析：仅约束我们依赖的字段，其余透传）
const appInfoSchema = z
  .object({
    releaseState: z.union([z.number(), z.string()]).optional(),
    status: z.union([z.number(), z.string()]).optional(),
    versionCode: z.coerce.number().optional(),
    versionNumber: z.coerce.string().optional(),
    onShelfVersionNumber: z.coerce.string().optional(),
    versionName: z.coerce.string().optional(),
  })
  .passthrough();

// 华为上传地址响应中 headers 可能是数组或对象两种形态
const uploadHeadersSchema = z
  .union([
    z.array(z.object({ key: z.string().optional(), name: z.string().optional(), value: z.string() }).passthrough()),
    z.record(z.string()),
  ])
  .optional();

/** 检查华为 API 业务返回码，ret.code !== 0 抛异常 */
function checkHwRet(respData: unknown, step: string, label: string): void {
  const ret = (respData as any)?.ret;
  if (ret && ret.code !== 0) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      channel: 'huawei',
      step,
      message: `${label}失败: ret.code=${ret.code}, ret.msg=${ret.msg ?? ''}`,
      retryable: true,
    });
  }
}

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  const client = createHttpClient();
  const resp = await client.post(`${BASE_URL}/api/oauth2/v1/token`, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  checkHwRet(resp.data, 'getToken', '获取 token');
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
  checkHwRet(resp.data, 'getAppId', '获取AppId');
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
  checkHwRet(resp.data, 'getUploadUrl', '获取上传地址');
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
  const parsedHeaders = uploadHeadersSchema.safeParse(urlInfo.headers);
  if (parsedHeaders.success && parsedHeaders.data) {
    const h = parsedHeaders.data;
    if (Array.isArray(h)) {
      for (const item of h) {
        const key = item.key ?? item.name;
        if (key) headers[key] = item.value;
      }
    } else {
      Object.assign(headers, h);
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
  checkHwRet(resp.data, 'bindApk', '绑定APK');
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
    checkHwRet(resp.data, 'waitCompile', '查询编译状态');
    const pkgState = resp.data?.pkgStateList?.[0];
    const state = pkgState?.successStatus ?? pkgState?.pkgState ?? resp.data?.compileStatus;
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
    const info = appInfoSchema.parse((resp.data?.appInfo ?? resp.data) ?? {});
    const reviewState = mapReviewState(info.releaseState ?? info.status);
    return {
      reviewState,
      enableSubmit: reviewState === 'online' || reviewState === 'rejected',
      lastVersionCode: info.versionCode ?? 0,
      lastVersionName: info.versionNumber ?? info.onShelfVersionNumber ?? info.versionName ?? '0',
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
    const descResp = await client.put(
      `${BASE_URL}/api/publish/v2/app-language-info`,
      { lang: 'zh-CN', appDesc: ctx.desc },
      { headers: { client_id: creds.client_id, Authorization: `Bearer ${token}` }, params: { appId } },
    );
    checkHwRet(descResp.data, 'updateDesc', '更新版本描述');
    ctx.onProgress({ step: 'submit' });
    const submitResp = await client.post(`${BASE_URL}/api/publish/v2/app-submit`, null, {
      headers: { client_id: creds.client_id, Authorization: `Bearer ${token}` },
      params: { appId },
    });
    checkHwRet(submitResp.data, 'submit', '提交审核');
    ctx.onProgress({ step: 'done', percent: 100 });
    return { message: '提交审核成功' };
  },
};

function mapReviewState(state: unknown): MarketInfo['reviewState'] {
  const s = Number(state);
  if (s === 0 || s === 7) return 'online';        // 已上架 / 草稿
  if (s === 4 || s === 5) return 'reviewing';     // 审核中 / 升级中
  if (s === 1 || s === 8) return 'rejected';      // 上架审核不通过 / 升级审核不通过
  // 已下架(2) / 待上架(3) / 申请下架(6) / 下架审核不通过(9) / 开发者下架(10) / 撤销上架(11) 等
  return 'unknown';
}
