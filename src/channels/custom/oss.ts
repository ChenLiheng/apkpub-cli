import OSS from 'ali-oss';
import path from 'node:path';
import type { CustomChannelConfig } from '../../config/schema.js';
import { ApkpubError, ErrorCode } from '../../errors/ApkpubError.js';
import { md5Sign } from '../../signers/md5.js';
import { assertSafeUrl, assertSafeUrlAsync, createHttpClient } from '../../utils/http.js';
import { renderTemplate } from '../../utils/template.js';
import type { UploadContext, UploadResult } from '../Channel.js';

interface StsToken {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
  expiration: string;
}

/** 获取 STS 临时凭证 */
async function fetchStsToken(
  stsTokenUrl: string,
  signKey: string,
  contextB: string,
): Promise<StsToken> {
  await assertSafeUrlAsync(stsTokenUrl, 'STS Token URL', { allowHttp: true, warnOnHttp: true });
  const sign = md5Sign(contextB, signKey);
  const client = createHttpClient();
  const response = await client.post(
    stsTokenUrl,
    new URLSearchParams({ c: JSON.stringify({ mode: 'text' }), b: contextB, sign }).toString(),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  );
  if (response.status !== 200) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_AUTH_FAILED,
      message: `获取 STS Token 失败: HTTP ${response.status}`,
      retryable: response.status >= 500,
    });
  }
  const data = response.data?.data;
  if (!data?.AccessKeyId) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_AUTH_FAILED,
      message: 'STS Token 响应格式无效',
      retryable: false,
    });
  }
  return {
    accessKeyId: data.AccessKeyId,
    accessKeySecret: data.AccessKeySecret,
    securityToken: data.SecurityToken,
    expiration: data.Expiration,
  };
}

/** 创建 OSS 客户端 */
async function createOssClient(config: CustomChannelConfig): Promise<OSS> {
  if (!config.endpoint || !config.bucket) {
    throw new ApkpubError({
      code: ErrorCode.CONFIG_INVALID,
      message: 'OSS 渠道需要配置 endpoint 和 bucket',
      retryable: false,
    });
  }
  assertSafeUrl(config.endpoint.startsWith('http') ? config.endpoint : `https://${config.endpoint}`, 'OSS endpoint');

  if (!config.auth) {
    throw new ApkpubError({
      code: ErrorCode.CONFIG_INVALID,
      message: 'OSS 渠道需要配置 auth',
      retryable: false,
    });
  }

  if (config.auth.mode === 'ak') {
    return new OSS({
      region: extractRegion(config.endpoint),
      accessKeyId: config.auth.accessKeyId,
      accessKeySecret: config.auth.accessKeySecret,
      bucket: config.bucket,
      endpoint: config.endpoint,
    });
  }

  const sts = await fetchStsToken(config.auth.stsTokenUrl, config.auth.signKey, config.auth.contextB);
  return new OSS({
    region: extractRegion(config.endpoint),
    accessKeyId: sts.accessKeyId,
    accessKeySecret: sts.accessKeySecret,
    stsToken: sts.securityToken,
    bucket: config.bucket,
    endpoint: config.endpoint,
    refreshSTSToken: async () => {
      const auth = config.auth;
      if (!auth || auth.mode !== 'sts') {
        throw new ApkpubError({ code: ErrorCode.CHANNEL_AUTH_FAILED, message: 'STS 配置无效', retryable: false });
      }
      const refreshed = await fetchStsToken(auth.stsTokenUrl, auth.signKey, auth.contextB);
      return {
        accessKeyId: refreshed.accessKeyId,
        accessKeySecret: refreshed.accessKeySecret,
        stsToken: refreshed.securityToken,
      };
    },
  });
}

function extractRegion(endpoint: string): string {
  const match = endpoint.match(/oss-([a-z0-9-]+)\./);
  return match?.[1] ?? 'cn-beijing';
}

/** OSS 上传 */
export async function uploadToOss(ctx: UploadContext, config: CustomChannelConfig): Promise<UploadResult> {
  ctx.onProgress({ step: 'connecting' });
  const fileName = path.basename(ctx.filePath);
  const objectKey = renderTemplate(config.objectKeyTemplate, {
    appId: ctx.apkInfo.applicationId,
    versionName: ctx.apkInfo.versionName,
    versionCode: ctx.apkInfo.versionCode,
    fileName,
  });

  const client = await createOssClient(config);
  ctx.onProgress({ step: 'uploading', percent: 0 });

  await client.multipartUpload(objectKey, ctx.filePath, {
    progress: (p: number) => {
      ctx.onProgress({ step: 'uploading', percent: Math.round(p * 100) });
    },
  } as Parameters<typeof client.multipartUpload>[2]);

  const downloadUrl = renderTemplate(config.downloadUrlTemplate, {
    appId: ctx.apkInfo.applicationId,
    versionName: ctx.apkInfo.versionName,
    versionCode: ctx.apkInfo.versionCode,
    fileName,
    objectKey,
  });

  ctx.onProgress({ step: 'done', percent: 100 });
  return { downloadUrl, message: '上传成功' };
}
