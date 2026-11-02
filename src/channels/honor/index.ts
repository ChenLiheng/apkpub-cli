import { z } from 'zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import FormData from 'form-data';
import type { Channel, UploadContext } from '../Channel.js';
import { createHttpClient } from '../../utils/http.js';
import { fileSha256 } from '../../utils/files.js';
import { ApkpubError, ErrorCode } from '../../errors/ApkpubError.js';

const BASE_URL = 'https://appmarket-openapi-drcn.cloud.honor.com';
const TOKEN_URL = 'https://iam.developer.honor.com/auth/token';

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

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  const client = createHttpClient();
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
    message: `获取 token 失败`,
    retryable: false,
  });
}

async function getAppId(token: string, packageName: string): Promise<string> {
  const client = createHttpClient();
  const resp = await client.get(`${BASE_URL}/openapi/v1/publish/get-app-id`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { pkgName: packageName },
  });
  checkHonorResult(resp.data, 'getAppId');
  const list = resp.data.data ?? [];
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

function checkHonorResult(data: { code?: number; message?: string; msg?: string }, action: string): void {
  if (data.code !== 0) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      channel: 'honor',
      step: action,
      // 荣耀的失败文案字段是 msg（部分接口用 message），两者都读，避免只剩裸错误码
      message: data.message ?? data.msg ?? `荣耀 API 失败: code=${data.code}`,
      retryable: false,
    });
  }
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
    // 线上正式版本：get-app-detail 的 releaseInfo（get-app-current-release 返回的可能是未提交草稿）
    const detailResp = await client.get(`${BASE_URL}/openapi/v1/publish/get-app-detail`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { appId: honorAppId },
    });
    checkHonorResult(detailResp.data, 'getAppInfo');
    const releaseInfo = detailResp.data?.data?.releaseInfo ?? {};
    // 当前管线状态（草稿/审核中/上线）
    const resp = await client.get(`${BASE_URL}/openapi/v1/publish/get-app-current-release`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { appId: honorAppId },
    });
    checkHonorResult(resp.data, 'getReviewState');
    const data = releaseInfoSchema.parse(resp.data?.data ?? {});
    // releaseId 为 null 说明是未提交草稿（曾上传但未提交审核），不算审核状态
    const isDraft = data.releaseId == null;
    const reviewState = isDraft
      ? 'unknown'
      : data.auditResult === 0
        ? 'reviewing'
        : data.auditResult === 1
          ? 'online'
          : data.auditResult === 2
            ? 'rejected'
            : 'unknown';
    return {
      reviewState,
      enableSubmit: true,
      lastVersionCode: Number(releaseInfo.versionCode ?? 0),
      lastVersionName: String(releaseInfo.versionName ?? '0'),
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
    const token = await getToken(creds.client_id, creds.client_secret);
    const auth = `Bearer ${token}`;
    ctx.onProgress({ step: 'getAppId' });
    const appId = await getAppId(token, ctx.apkInfo.applicationId);
    const client = createHttpClient();
    ctx.onProgress({ step: 'getAppInfo' });
    const appInfoResp = await client.get(`${BASE_URL}/openapi/v1/publish/get-app-detail`, {
      headers: { Authorization: auth },
      params: { appId },
    });
    checkHonorResult(appInfoResp.data, 'getAppInfo');
    const langInfo = appInfoResp.data.data?.languageInfo?.[0] ?? {};
    ctx.onProgress({ step: 'getUploadUrl' });
    const sha256 = await fileSha256(ctx.filePath);
    const uploadUrlResp = await client.post(
      `${BASE_URL}/openapi/v1/publish/get-file-upload-url`,
      [{ fileName, fileType: 100, fileSize: ctx.apkInfo.size, fileSha256: sha256 }],
      { headers: { Authorization: auth }, params: { appId } },
    );
    checkHonorResult(uploadUrlResp.data, 'getUploadUrl');
    const uploadInfo = uploadUrlResp.data.data[0];
    ctx.onProgress({ step: 'uploading', percent: 0 });
    // 必须用 Buffer 而不是 createReadStream：form-data 对 Stream 无法计算 Content-Length，
    // axios 会退化成 chunked 上传，荣耀 file-upload 仍返回 code 0 但文件未入库，
    // 随后绑定报 20030 objectId is not exists（同华为 OBS 上传的历史坑）
    const fileBuffer = readFileSync(ctx.filePath);
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: fileName,
      contentType: 'application/vnd.android.package-archive',
    });
    const uploadResp = await client.post(uploadInfo.uploadUrl, form, {
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
        message: `上传文件失败: ${JSON.stringify(uploadResp.data)}`,
        retryable: true,
      });
    }
    ctx.onProgress({ step: 'bindApk' });
    const bindResp = await client.post(
      `${BASE_URL}/openapi/v1/publish/update-file-info`,
      // 绑定字段名必须是 bindingFileList（对照 laiBao HonorBindApkFile.kt）；
      // 用 fileInfoList 时荣耀返回 code 0 但不绑定，后续 submit 报 30036 APK file not bound
      { bindingFileList: [{ objectId: uploadInfo.objectId }] },
      { headers: { Authorization: auth }, params: { appId } },
    );
    checkHonorResult(bindResp.data, 'bindApk');
    ctx.onProgress({ step: 'updateDesc' });
    const descResp = await client.post(
      `${BASE_URL}/openapi/v1/publish/update-language-info`,
      {
        languageInfoList: [{
          appName: langInfo.appName,
          intro: langInfo.intro,
          // 荣耀接口的「新版本更新说明」字段名是 newFeature（对照 laiBao HonorVersionDesc.kt）
          newFeature: ctx.desc,
          briefIntro: langInfo.briefIntro,
          languageId: langInfo.languageId ?? 'zh-CN',
        }],
      },
      { headers: { Authorization: auth }, params: { appId } },
    );
    checkHonorResult(descResp.data, 'updateDesc');
    ctx.onProgress({ step: 'submit' });
    const submitResp = await client.post(`${BASE_URL}/openapi/v1/publish/submit-audit`, { releaseType: 1 }, {
      headers: { Authorization: auth },
      params: { appId },
    });
    checkHonorResult(submitResp.data, 'submit');
    ctx.onProgress({ step: 'done', percent: 100 });
    return { message: '提交审核成功' };
  },
};
