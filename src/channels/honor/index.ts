import { z } from 'zod';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import FormData from 'form-data';
import type { Channel, UploadContext } from '../Channel.js';
import { createHttpClient, ensureJsonObject, withRetry } from '../../utils/http.js';
import { fileSha256 } from '../../utils/files.js';
import { ApkpubError, ErrorCode } from '../../errors/ApkpubError.js';

const BASE_URL = 'https://appmarket-openapi-drcn.cloud.honor.com';
const TOKEN_URL = 'https://iam.developer.honor.com/auth/token';
/** APK 文件上传超时（大包上传耗时较长） */
const UPLOAD_TIMEOUT_MS = 600_000;

const credSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

// 荣耀当前版本信息响应（宽松解析：仅约束依赖字段，其余透传）
const releaseInfoSchema = z
  .object({
    auditResult: z.coerce.number().optional(),
    versionCode: z.coerce.number().optional(),
    versionName: z.coerce.string().optional(),
  })
  .passthrough();

async function getToken(clientId: string, clientSecret: string, signal?: AbortSignal): Promise<string> {
  const client = createHttpClient({ signal });
  const resp = await client.post(
    TOKEN_URL,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }).toString(),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  );
  if (resp.data?.access_token) return resp.data.access_token as string;
  throw new ApkpubError({
    code: ErrorCode.CHANNEL_AUTH_FAILED,
    channel: 'honor',
    step: 'getToken',
    message: `获取 token 失败 (HTTP ${resp.status})`,
    // 网关 5xx 可重试，凭证错误等 4xx 不重试
    retryable: resp.status >= 500,
  });
}

async function getAppId(token: string, packageName: string, signal?: AbortSignal): Promise<string> {
  const client = createHttpClient({ signal });
  const resp = await client.get(`${BASE_URL}/openapi/v1/publish/get-app-id`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { pkgName: packageName },
  });
  const list = checkHonorResult(resp.data, 'getAppId', resp.status).data ?? [];
  if (!list.length) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_STATE_FAILED,
      channel: 'honor',
      message: `未找到包名 ${packageName}`,
      retryable: false,
    });
  }
  return list[0].appId;
}

/** 校验荣耀业务返回码，返回已校验的响应对象 */
function checkHonorResult(raw: unknown, action: string, status?: number): Record<string, any> {
  const data = ensureJsonObject(raw, { channel: 'honor', step: action, status });
  if (data.code !== 0) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      channel: 'honor',
      step: action,
      message: data.message ?? `荣耀 API 失败: code=${data.code}`,
      retryable: false,
    });
  }
  return data;
}

export const honorChannel: Channel = {
  name: 'honor',
  label: '荣耀',
  type: 'market',
  fileNameIdentify: 'HONOR',
  credentialSchema: credSchema,
  async getMarketState(appId, config) {
    const creds = credSchema.parse(config);
    const token = await getToken(creds.client_id, creds.client_secret);
    const honorAppId = await getAppId(token, appId);
    const client = createHttpClient();
    const resp = await client.get(`${BASE_URL}/openapi/v1/publish/get-app-current-release`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { appId: honorAppId },
    });
    const data = releaseInfoSchema.parse(checkHonorResult(resp.data, 'getReviewState', resp.status).data ?? {});
    const reviewState =
      data.auditResult === 0 ? 'reviewing' : data.auditResult === 1 ? 'online' : data.auditResult === 2 ? 'rejected' : 'unknown';
    return {
      reviewState,
      enableSubmit: reviewState !== 'reviewing',
      lastVersionCode: data.versionCode ?? 0,
      lastVersionName: data.versionName ?? '0',
    };
  },
  async validateCredentials(config) {
    const creds = credSchema.parse(config);
    await getToken(creds.client_id, creds.client_secret);
  },
  async upload(ctx: UploadContext) {
    const creds = credSchema.parse(ctx.config);
    const fileName = path.basename(ctx.filePath);
    const { signal } = ctx;
    const retry = <T>(fn: () => Promise<T>) => withRetry(fn, { signal });
    ctx.onProgress({ step: 'getToken' });
    const token = await retry(() => getToken(creds.client_id, creds.client_secret, signal));
    const auth = `Bearer ${token}`;
    ctx.onProgress({ step: 'getAppId' });
    const appId = await retry(() => getAppId(token, ctx.apkInfo.applicationId, signal));
    const client = createHttpClient({ signal });
    ctx.onProgress({ step: 'getAppInfo' });
    const appInfo = await retry(async () => {
      const resp = await client.get(`${BASE_URL}/openapi/v1/publish/get-app-detail`, {
        headers: { Authorization: auth },
        params: { appId },
      });
      return checkHonorResult(resp.data, 'getAppInfo', resp.status);
    });
    const langInfo = appInfo.data?.languageInfo?.[0] ?? {};
    ctx.onProgress({ step: 'getUploadUrl' });
    const sha256 = await fileSha256(ctx.filePath);
    const uploadUrlData = await retry(async () => {
      const resp = await client.post(
        `${BASE_URL}/openapi/v1/publish/get-file-upload-url`,
        [{ fileName, fileType: 100, fileSize: ctx.apkInfo.size, fileSha256: sha256 }],
        { headers: { Authorization: auth }, params: { appId } },
      );
      return checkHonorResult(resp.data, 'getUploadUrl', resp.status);
    });
    const uploadInfo = uploadUrlData.data?.[0];
    if (!uploadInfo?.url) {
      throw new ApkpubError({
        code: ErrorCode.CHANNEL_UPLOAD_FAILED,
        channel: 'honor',
        step: 'getUploadUrl',
        message: `获取上传地址失败: ${JSON.stringify(uploadUrlData)}`,
        retryable: false,
      });
    }
    ctx.onProgress({ step: 'uploading', percent: 0 });
    const uploadClient = createHttpClient({ timeout: UPLOAD_TIMEOUT_MS, signal });
    const form = new FormData();
    form.append('file', createReadStream(ctx.filePath), { filename: fileName });
    const uploadResp = await uploadClient.post(uploadInfo.url, form, {
      headers: { Authorization: auth, ...form.getHeaders() },
      maxBodyLength: Infinity,
      onUploadProgress: (e) => {
        if (e.total) ctx.onProgress({ step: 'uploading', percent: Math.round((e.loaded / e.total) * 100) });
      },
    });
    if (uploadResp.data?.code !== 0) {
      throw new ApkpubError({
        code: ErrorCode.CHANNEL_UPLOAD_FAILED,
        channel: 'honor',
        step: 'uploadFile',
        message: `上传文件失败 (HTTP ${uploadResp.status}): ${JSON.stringify(uploadResp.data)}`,
        retryable: true,
      });
    }
    ctx.onProgress({ step: 'bindApk' });
    const bindResp = await client.post(
      `${BASE_URL}/openapi/v1/publish/update-file-info`,
      { fileInfoList: [{ objectId: uploadInfo.objectId }] },
      { headers: { Authorization: auth }, params: { appId } },
    );
    checkHonorResult(bindResp.data, 'bindApk', bindResp.status);
    ctx.onProgress({ step: 'updateDesc' });
    const descResp = await client.post(
      `${BASE_URL}/openapi/v1/publish/update-language-info`,
      {
        languageInfoList: [{
          appName: langInfo.appName,
          intro: langInfo.intro,
          desc: ctx.desc,
          briefIntro: langInfo.briefIntro,
        }],
      },
      { headers: { Authorization: auth }, params: { appId } },
    );
    checkHonorResult(descResp.data, 'updateDesc', descResp.status);
    ctx.onProgress({ step: 'submit' });
    const submitResp = await client.post(`${BASE_URL}/openapi/v1/publish/submit-audit`, { releaseType: 1 }, {
      headers: { Authorization: auth },
      params: { appId },
    });
    checkHonorResult(submitResp.data, 'submit', submitResp.status);
    ctx.onProgress({ step: 'done', percent: 100 });
    return { message: '提交审核成功' };
  },
};
