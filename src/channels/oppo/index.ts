import { z } from 'zod';
import { createReadStream } from 'node:fs';
import FormData from 'form-data';
import type { Channel, UploadContext } from '../Channel.js';
import { createHttpClient } from '../../utils/http.js';
import { signSortedParams } from '../../signers/hmac.js';
import { ApkpubError, ErrorCode } from '../../errors/ApkpubError.js';

const DOMAIN = 'https://oop-openapi-cn.heytapmobi.com';

const credSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

// OPPO 应用信息响应（宽松解析：仅约束依赖字段，其余透传）
const appInfoSchema = z
  .object({
    version_code: z.coerce.number().optional(),
    version_name: z.coerce.string().optional(),
    audit_status: z.coerce.number().optional(),
  })
  .passthrough();

function buildSignedUrl(
  originUrl: string,
  params: Record<string, string>,
  token: string,
  clientSecret: string,
  appendQuery: boolean,
): string {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const allParams: Record<string, string> = { ...params, access_token: token, timestamp };
  const url = new URL(originUrl);
  if (appendQuery) {
    for (const [k, v] of Object.entries(allParams)) {
      url.searchParams.set(k, v);
    }
  }
  url.searchParams.set('access_token', token);
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('api_sign', signSortedParams(allParams, clientSecret));
  return url.toString();
}

export const oppoChannel: Channel = {
  name: 'oppo',
  label: 'OPPO',
  type: 'market',
  fileNameIdentify: 'OPPO',
  credentialSchema: credSchema,
  async getMarketState(appId, config) {
    const creds = credSchema.parse(config);
    const token = await getToken(creds);
    const client = createHttpClient();
    const url = buildSignedUrl(`${DOMAIN}/resource/v1/app/info`, { pkg_name: appId }, token, creds.client_secret, true);
    const resp = await client.get(url);
    checkOppoResult(resp.data, '获取App信息');
    const data = appInfoSchema.parse(resp.data?.data ?? {});
    return {
      // OPPO audit_status 为 111 表示已上架，其余视为审核中
      reviewState: data.audit_status === 111 ? 'online' : 'reviewing',
      enableSubmit: true,
      lastVersionCode: data.version_code ?? 0,
      lastVersionName: data.version_name ?? '0',
    };
  },
  async validateCredentials(config) {
    const creds = credSchema.parse(config);
    await getToken(creds);
  },
  async upload(ctx: UploadContext) {
    const creds = credSchema.parse(ctx.config);
    ctx.onProgress({ step: 'getToken' });
    const token = await getToken(creds);
    const client = createHttpClient();
    ctx.onProgress({ step: 'getAppInfo' });
    const appInfoUrl = buildSignedUrl(
      `${DOMAIN}/resource/v1/app/info`,
      { pkg_name: ctx.apkInfo.applicationId },
      token,
      creds.client_secret,
      true,
    );
    const appInfoResp = await client.get(appInfoUrl);
    checkOppoResult(appInfoResp.data, '获取App信息');
    const appInfo = appInfoResp.data.data;
    ctx.onProgress({ step: 'getUploadUrl' });
    const uploadUrlResp = await client.get(
      buildSignedUrl(`${DOMAIN}/resource/v1/upload/get-upload-url`, {}, token, creds.client_secret, true),
    );
    checkOppoResult(uploadUrlResp.data, '获取上传url');
    const { upload_url: rawUploadUrl, sign } = uploadUrlResp.data.data;
    ctx.onProgress({ step: 'uploading', percent: 0 });
    const signedUploadUrl = buildSignedUrl(
      rawUploadUrl,
      { type: 'apk', sign },
      token,
      creds.client_secret,
      false,
    );
    const form = new FormData();
    form.append('file', createReadStream(ctx.filePath), { filename: 'app.apk' });
    form.append('type', 'apk');
    form.append('sign', sign);
    const uploadResp = await client.post(signedUploadUrl, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      onUploadProgress: (e) => {
        if (e.total) ctx.onProgress({ step: 'uploading', percent: Math.round((e.loaded / e.total) * 100) });
      },
    });
    checkOppoResult(uploadResp.data, '上传Apk');
    const apkResult = uploadResp.data.data;
    ctx.onProgress({ step: 'submit' });
    const apkUrl = JSON.stringify([{ url: apkResult.url, md5: apkResult.md5, cpu_code: 0 }]);
    const submitParams: Record<string, string> = {
      pkg_name: ctx.apkInfo.applicationId,
      version_code: String(ctx.apkInfo.versionCode),
      apk_url: apkUrl,
      update_desc: ctx.desc,
      online_type: '1',
      second_category_id: String(appInfo.ver_second_category_id ?? appInfo.second_category_id ?? appInfo.secondCategory ?? ''),
      third_category_id: String(appInfo.ver_third_category_id ?? appInfo.third_category_id ?? appInfo.thirdCategory ?? ''),
      summary: appInfo.summary ?? '',
      detail_desc: appInfo.detail_desc ?? appInfo.detailDesc ?? '',
      privacy_source_url: appInfo.privacy_source_url ?? appInfo.privacyUrl ?? '',
      icon_url: appInfo.icon_url ?? appInfo.iconUrl ?? '',
      pic_url: appInfo.pic_url ?? appInfo.picUrl ?? '',
      test_desc: appInfo.test_desc ?? appInfo.testDesc ?? '',
      business_username: appInfo.business_username ?? appInfo.businessUsername ?? '',
      business_email: appInfo.business_email ?? appInfo.businessEmail ?? '',
      business_mobile: appInfo.business_mobile ?? appInfo.businessMobile ?? '',
      copyright_url: appInfo.copyright_url ?? appInfo.copyrightUrl ?? '',
    };
    const submitUrl = buildSignedUrl(`${DOMAIN}/resource/v1/app/upd`, submitParams, token, creds.client_secret, false);
    const submitForm = new URLSearchParams(submitParams);
    const submitResp = await client.post(submitUrl, submitForm.toString(), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    checkOppoResult(submitResp.data, '提交版本');
    ctx.onProgress({ step: 'done', percent: 100 });
    return { message: '提交成功' };
  },
};

async function getToken(creds: { client_id: string; client_secret: string }): Promise<string> {
  const client = createHttpClient();
  const resp = await client.get(`${DOMAIN}/developer/v1/token`, {
    params: { client_id: creds.client_id, client_secret: creds.client_secret },
  });
  checkOppoResult(resp.data, '获取token');
  return resp.data.data.access_token as string;
}

function checkOppoResult(data: { errno?: number; data?: { message?: string } }, action: string): void {
  if (data.errno !== 0) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      channel: 'oppo',
      message: `${action}失败: ${data.data?.message ?? '未知错误'}`,
      retryable: false,
    });
  }
}
