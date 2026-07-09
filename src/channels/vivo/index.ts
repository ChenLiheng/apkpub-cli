import { z } from 'zod';
import { createReadStream } from 'node:fs';
import FormData from 'form-data';
import type { Channel, MarketInfo, UploadContext } from '../Channel.js';
import { MarketStateCache } from '../marketCache.js';
import { createHttpClient } from '../../utils/http.js';
import { fileMd5 } from '../../utils/files.js';
import { vivoSignParams } from '../../signers/hmac.js';
import { ApkpubError, ErrorCode } from '../../errors/ApkpubError.js';

// VIVO API 查询缓存（带 TTL），避免单次发布内重复查询触发频率限制
const queryCache = new MarketStateCache<{ state: MarketInfo; onlineType: number }>();

const DOMAIN = 'https://developer-api.vivo.com.cn/router/rest';

const credSchema = z.object({
  access_key: z.string().min(1),
  access_secret: z.string().min(1),
});

// VIVO 应用详情响应（宽松解析：仅约束依赖字段，其余透传）
const appDetailSchema = z
  .object({
    versionCode: z.coerce.number().optional(),
    versionName: z.coerce.string().optional(),
    onlineType: z.coerce.number().optional(),
  })
  .passthrough();

function buildUrl(method: string, params: Record<string, string>, accessKey: string, accessSecret: string): string {
  const signed = vivoSignParams(accessKey, accessSecret, method, params);
  const url = new URL(DOMAIN);
  for (const [k, v] of Object.entries(signed)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

export const vivoChannel: Channel = {
  name: 'vivo',
  label: 'VIVO',
  type: 'market',
  fileNameIdentify: 'VIVO',
  credentialSchema: credSchema,
  async getMarketState(appId, config) {
    const cached = queryCache.get(appId);
    if (cached) return cached.state;
    const creds = credSchema.parse(config);
    const client = createHttpClient();
    const url = buildUrl('app.query.details', { packageName: appId }, creds.access_key, creds.access_secret);
    const resp = await client.get(url);
    checkVivoResult(resp.data, '查询应用详情');
    const data = appDetailSchema.parse(resp.data?.data ?? {});
    const marketState = {
      reviewState: 'online' as const,
      enableSubmit: true,
      lastVersionCode: data.versionCode ?? 0,
      lastVersionName: data.versionName ?? '0',
    };
    queryCache.set(appId, { state: marketState, onlineType: data.onlineType ?? 1 });
    return marketState;
  },
  async validateCredentials(config) {
    credSchema.parse(config);
  },
  async upload(ctx: UploadContext) {
    const creds = credSchema.parse(ctx.config);
    const client = createHttpClient({ timeout: 600_000 });
    ctx.onProgress({ step: 'getAppInfo' });
    await vivoChannel.getMarketState!(ctx.apkInfo.applicationId, ctx.config);
    const cached = queryCache.get(ctx.apkInfo.applicationId);
    const appInfo = cached ?? { onlineType: 1 };
    ctx.onProgress({ step: 'uploading', percent: 0 });
    const fileMd5Hash = await fileMd5(ctx.filePath);
    const uploadUrl = buildUrl(
      'app.upload.apk.app',
      { packageName: ctx.apkInfo.applicationId, fileMd5: fileMd5Hash },
      creds.access_key,
      creds.access_secret,
    );
    const form = new FormData();
    form.append('file', createReadStream(ctx.filePath), { filename: 'app.apk' });
    const uploadResp = await client.post(uploadUrl, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      onUploadProgress: (e) => {
        if (e.total) ctx.onProgress({ step: 'uploading', percent: Math.round((e.loaded / e.total) * 100) });
      },
    });
    checkVivoResult(uploadResp.data, '上传apk');
    const apkResult = uploadResp.data.data;
    ctx.onProgress({ step: 'submit' });
    const submitUrl = buildUrl(
      'app.sync.update.app',
      {
        packageName: apkResult.packageName,
        versionCode: String(apkResult.versionCode),
        apk: apkResult.serialnumber,
        fileMd5: apkResult.fileMd5,
        // onlineType：1=审核通过后立即发布，2=定时发布（需配合 onlineTime）；此处沿用线上应用当前的发布类型，默认立即发布
        onlineType: String(appInfo.onlineType ?? 1),
        updateDesc: ctx.desc,
      },
      creds.access_key,
      creds.access_secret,
    );
    const submitResp = await client.get(submitUrl);
    checkVivoResult(submitResp.data, '提交更新');
    ctx.onProgress({ step: 'done', percent: 100 });
    return { message: '提交成功' };
  },
};

function checkVivoResult(data: { code?: number; subCode?: string; msg?: string }, action: string): void {
  const subCode = Number(data.subCode ?? -1);
  if (data.code !== 0 || subCode !== 0) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      channel: 'vivo',
      message: `${action}失败: ${data.msg ?? '未知错误'}`,
      retryable: false,
    });
  }
}
