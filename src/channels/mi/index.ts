import { z } from 'zod';
import { createReadStream } from 'node:fs';
import FormData from 'form-data';
import type { Channel, MarketInfo, UploadContext } from '../Channel.js';
import { createHttpClient } from '../../utils/http.js';
import { fileMd5 } from '../../utils/files.js';
import { rsaEncrypt } from '../../signers/rsa.js';
import { md5Hex } from '../../signers/md5.js';
import { ApkpubError, ErrorCode } from '../../errors/ApkpubError.js';

const DOMAIN = 'https://api.developer.xiaomi.com/devupload';
const QUERY_URL = `${DOMAIN}/dev/query`;
const PUSH_URL = `${DOMAIN}/dev/push`;

const credSchema = z.object({
  account: z.string().min(1),
  publicKey: z.string().min(1),
  privateKey: z.string().min(1),
});

function buildSig(privateKey: string, hashes: { name: string; hash: string }[]): string {
  const sig = JSON.stringify({
    password: privateKey,
    sig: hashes.map((h) => ({ name: h.name, hash: h.hash })),
  });
  return sig;
}

// 小米 API 响应缓存，避免单次发布内重复调用触发频率限制
// 带 TTL 失效，防止 MCP 长驻进程读取到陈旧的线上版本信息
const CACHE_TTL_MS = 60_000;
const queryCache = new Map<string, { state: MarketInfo; appName: string; expireAt: number }>();

function readCache(appId: string): { state: MarketInfo; appName: string } | undefined {
  const cached = queryCache.get(appId);
  if (!cached) return undefined;
  if (Date.now() > cached.expireAt) {
    queryCache.delete(appId);
    return undefined;
  }
  return cached;
}

export const miChannel: Channel = {
  name: 'mi',
  label: '小米',
  type: 'market',
  fileNameIdentify: 'MI',
  credentialSchema: credSchema,
  async getMarketState(appId, config) {
    const cached = readCache(appId);
    if (cached) return cached.state;
    const creds = credSchema.parse(config);
    const requestData = JSON.stringify({ userName: creds.account, packageName: appId });
    const sigData = buildSig(creds.privateKey, [{ name: 'RequestData', hash: md5Hex(requestData) }]);
    const client = createHttpClient();
    const form = new URLSearchParams();
    form.set('RequestData', requestData);
    form.set('SIG', rsaEncrypt(sigData, creds.publicKey));
    const resp = await client.post(QUERY_URL, form.toString(), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    checkMiResult(resp.data, '获取App信息');
    const info = resp.data.packageInfo ?? resp.data;
    const marketState = {
      reviewState: 'online' as const,
      enableSubmit: true,
      lastVersionCode: Number(info?.versionCode ?? 0),
      lastVersionName: String(info?.versionName ?? '0'),
    };
    const appName = String(info?.appName ?? '');
    queryCache.set(appId, { state: marketState, appName, expireAt: Date.now() + CACHE_TTL_MS });
    return marketState;
  },
  async validateCredentials(config) {
    credSchema.parse(config);
  },
  async upload(ctx: UploadContext) {
    const creds = credSchema.parse(ctx.config);
    ctx.onProgress({ step: 'getAppInfo' });
    const marketState = await miChannel.getMarketState!(ctx.apkInfo.applicationId, ctx.config);
    const cachedAppName = (readCache(ctx.apkInfo.applicationId)?.appName || marketState?.lastVersionName) ?? ctx.apkInfo.versionName;
    const requestData = JSON.stringify({
      userName: creds.account,
      synchroType: 1,
      appInfo: {
        appName: cachedAppName,
        packageName: ctx.apkInfo.applicationId,
        updateDesc: ctx.desc,
      },
    });
    const apkHash = await fileMd5(ctx.filePath);
    const sigData = buildSig(creds.privateKey, [
      { name: 'RequestData', hash: md5Hex(requestData) },
      { name: 'apk', hash: apkHash },
    ]);
    ctx.onProgress({ step: 'uploading', percent: 0 });
    const form = new FormData();
    form.append('apk', createReadStream(ctx.filePath), { filename: 'app.apk' });
    form.append('RequestData', requestData);
    form.append('SIG', rsaEncrypt(sigData, creds.publicKey));
    const client = createHttpClient({ timeout: 600_000 });
    const resp = await client.post(PUSH_URL, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      onUploadProgress: (e) => {
        if (e.total) ctx.onProgress({ step: 'uploading', percent: Math.round((e.loaded / e.total) * 100) });
      },
    });
    checkMiResult(resp.data, '上传Apk');
    ctx.onProgress({ step: 'done', percent: 100 });
    return { message: '提交成功' };
  },
};

function checkMiResult(data: { result?: number; message?: string }, action: string): void {
  if (data.result !== 0) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_UPLOAD_FAILED,
      channel: 'mi',
      message: `${action}失败: ${data.message ?? '未知错误'}`,
      retryable: false,
    });
  }
}
