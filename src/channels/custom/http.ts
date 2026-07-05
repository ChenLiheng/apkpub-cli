import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import FormData from 'form-data';
import type { CustomChannelConfig } from '../../config/schema.js';
import { ApkpubError, ErrorCode } from '../../errors/ApkpubError.js';
import { assertSafeUrlAsync, createHttpClient } from '../../utils/http.js';
import { renderTemplate } from '../../utils/template.js';
import type { UploadContext, UploadResult } from '../Channel.js';

/** HTTP 上传 */
export async function uploadToHttp(ctx: UploadContext, config: CustomChannelConfig): Promise<UploadResult> {
  if (!config.uploadUrl) {
    throw new ApkpubError({
      code: ErrorCode.CONFIG_INVALID,
      message: 'HTTP 渠道需要配置 uploadUrl',
      retryable: false,
    });
  }

  const fileName = path.basename(ctx.filePath);
  const objectKey = renderTemplate(config.objectKeyTemplate, {
    appId: ctx.apkInfo.applicationId,
    versionName: ctx.apkInfo.versionName,
    versionCode: ctx.apkInfo.versionCode,
    fileName,
  });

  const uploadUrl = renderTemplate(config.uploadUrl, {
    appId: ctx.apkInfo.applicationId,
    versionName: ctx.apkInfo.versionName,
    versionCode: ctx.apkInfo.versionCode,
    fileName,
    objectKey,
  });

  await assertSafeUrlAsync(uploadUrl, '上传地址', { allowHttp: true, warnOnHttp: true });
  const client = createHttpClient({ timeout: 300_000 });
  const method = config.method ?? 'PUT';

  ctx.onProgress({ step: 'uploading', percent: 0 });

  if (method === 'PUT') {
    const data = await readFile(ctx.filePath);
    const response = await client.request({
      method: 'PUT',
      url: uploadUrl,
      data,
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        ...config.headers,
      },
      maxBodyLength: Infinity,
      signal: ctx.signal,
      onUploadProgress: (e) => {
        if (e.total) ctx.onProgress({ step: 'uploading', percent: Math.round((e.loaded / e.total) * 100) });
      },
    });
    checkUploadResponse(response.status);
  } else {
    const form = new FormData();
    const field = config.formField ?? 'file';
    form.append(field, createReadStream(ctx.filePath), { filename: fileName });
    const response = await client.post(uploadUrl, form, {
      headers: { ...form.getHeaders(), ...config.headers },
      maxBodyLength: Infinity,
      signal: ctx.signal,
      onUploadProgress: (e) => {
        if (e.total) ctx.onProgress({ step: 'uploading', percent: Math.round((e.loaded / e.total) * 100) });
      },
    });
    checkUploadResponse(response.status);
  }

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

function checkUploadResponse(status: number): void {
  if (status < 200 || status >= 300) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      message: `HTTP 上传失败: ${status}`,
      retryable: status >= 500,
    });
  }
}
