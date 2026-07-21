import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { loadConfig, saveConfig, validateConfig } from '../config/store.js';
import { getChannelMetas } from '../channels/registry.js';
import {
  CURRENT_SCHEMA_VERSION,
  type AppConfig,
  type ChannelConfig,
  type ChannelParam,
} from '../config/schema.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { logger } from '../utils/logger.js';
import { renderConfigUiPage } from './configUiPage.js';

/** UI 服务启动选项 */
export interface ConfigUiOptions {
  port?: number;
  open?: boolean;
}

/** 空闲自动关闭时间（毫秒） */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** 键值对（供前端记录类字段编辑） */
export interface KvPair {
  key: string;
  value: string;
}

/** 前端表单模型 - 市场渠道 */
export interface FormMarketChannel {
  type: 'market';
  name: string;
  enable: boolean;
  params: ChannelParam[];
}

/** 前端表单模型 - 自定义渠道 */
export interface FormCustomChannel {
  type: 'custom';
  name: string;
  enable: boolean;
  uploadType: 'oss' | 'http';
  fileNameIdentify: string;
  endpoint: string;
  bucket: string;
  authEnabled: boolean;
  authMode: 'ak' | 'sts';
  ak: { accessKeyId: string; accessKeySecret: string };
  sts: { stsTokenUrl: string; signKey: string; contextB: string };
  uploadUrl: string;
  method: '' | 'PUT' | 'POST';
  headers: KvPair[];
  formField: string;
  objectKeyTemplate: string;
  downloadUrlTemplate: string;
  params: ChannelParam[];
}

export type FormChannel = FormMarketChannel | FormCustomChannel;

/** 前端表单模型 - 整体 */
export interface FormModel {
  name: string;
  applicationId: string;
  enableChannel: boolean;
  channels: FormChannel[];
  extension: {
    updateDesc: string;
    apkDir: string;
    urls: KvPair[];
    lastVersionCode: KvPair[];
    lastVersionName: KvPair[];
  };
}

function recordToKv(record: Record<string, string | number> | undefined): KvPair[] {
  if (!record) return [];
  return Object.entries(record).map(([key, value]) => ({ key, value: String(value) }));
}

function kvToRecord(pairs: KvPair[]): Record<string, string> | undefined {
  const record: Record<string, string> = {};
  for (const { key, value } of pairs) {
    if (key.trim() === '') continue;
    record[key] = value;
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

function kvToNumberRecord(pairs: KvPair[]): Record<string, number> | undefined {
  const record: Record<string, number> = {};
  for (const { key, value } of pairs) {
    if (key.trim() === '') continue;
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new ApkpubError({
        code: ErrorCode.CONFIG_INVALID,
        message: `lastVersionCode.${key} 的值必须为数字，当前为「${value}」`,
        retryable: false,
      });
    }
    record[key] = num;
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : value;
}

/** AppConfig → 前端表单模型 */
export function configToFormModel(config: AppConfig): FormModel {
  const channels: FormChannel[] = config.channels.map((ch): FormChannel => {
    if (ch.type === 'custom') {
      return {
        type: 'custom',
        name: ch.name,
        enable: ch.enable,
        uploadType: ch.uploadType,
        fileNameIdentify: ch.fileNameIdentify ?? '',
        endpoint: ch.endpoint ?? '',
        bucket: ch.bucket ?? '',
        authEnabled: ch.auth !== undefined,
        authMode: ch.auth?.mode ?? 'ak',
        ak: {
          accessKeyId: ch.auth?.mode === 'ak' ? ch.auth.accessKeyId : '',
          accessKeySecret: ch.auth?.mode === 'ak' ? ch.auth.accessKeySecret : '',
        },
        sts: {
          stsTokenUrl: ch.auth?.mode === 'sts' ? ch.auth.stsTokenUrl : '',
          signKey: ch.auth?.mode === 'sts' ? ch.auth.signKey : '',
          contextB: ch.auth?.mode === 'sts' ? ch.auth.contextB : '{}',
        },
        uploadUrl: ch.uploadUrl ?? '',
        method: ch.method ?? '',
        headers: recordToKv(ch.headers),
        formField: ch.formField ?? '',
        objectKeyTemplate: ch.objectKeyTemplate,
        downloadUrlTemplate: ch.downloadUrlTemplate,
        params: ch.params.map((p) => ({ ...p })),
      };
    }
    return {
      type: 'market',
      name: ch.name,
      enable: ch.enable,
      params: ch.params.map((p) => ({ ...p })),
    };
  });

  return {
    name: config.name,
    applicationId: config.applicationId,
    enableChannel: config.enableChannel,
    channels,
    extension: {
      updateDesc: config.extension.updateDesc ?? '',
      apkDir: config.extension.apkDir ?? '',
      urls: recordToKv(config.extension.urls),
      lastVersionCode: recordToKv(config.extension.lastVersionCode),
      lastVersionName: recordToKv(config.extension.lastVersionName),
    },
  };
}

function toChannelConfig(fc: FormChannel): ChannelConfig {
  const params: ChannelParam[] = fc.params
    .filter((p) => p.name.trim() !== '')
    .map((p) => ({ name: p.name, value: p.value ?? '' }));

  if (fc.type === 'custom') {
    const auth = fc.authEnabled
      ? fc.authMode === 'ak'
        ? { mode: 'ak' as const, accessKeyId: fc.ak.accessKeyId, accessKeySecret: fc.ak.accessKeySecret }
        : {
            mode: 'sts' as const,
            stsTokenUrl: fc.sts.stsTokenUrl,
            signKey: fc.sts.signKey,
            contextB: fc.sts.contextB.trim() === '' ? '{}' : fc.sts.contextB,
          }
      : undefined;

    return {
      name: fc.name,
      type: 'custom',
      enable: fc.enable,
      uploadType: fc.uploadType,
      fileNameIdentify: emptyToUndefined(fc.fileNameIdentify),
      endpoint: emptyToUndefined(fc.endpoint),
      bucket: emptyToUndefined(fc.bucket),
      auth,
      uploadUrl: emptyToUndefined(fc.uploadUrl),
      method: fc.method === '' ? undefined : fc.method,
      headers: kvToRecord(fc.headers),
      formField: emptyToUndefined(fc.formField),
      objectKeyTemplate: fc.objectKeyTemplate,
      downloadUrlTemplate: fc.downloadUrlTemplate,
      params,
    };
  }

  return {
    name: fc.name,
    type: 'market',
    enable: fc.enable,
    params,
  };
}

/** 前端表单模型 → AppConfig（保留原配置的不可变字段并做 zod 校验） */
export function formModelToConfig(model: FormModel, original: AppConfig): AppConfig {
  const channels = model.channels.map(toChannelConfig);
  const seen = new Set<string>();
  for (const ch of channels) {
    if (ch.name.trim() === '') {
      throw new ApkpubError({
        code: ErrorCode.CONFIG_INVALID,
        message: '渠道名称不能为空',
        retryable: false,
      });
    }
    if (seen.has(ch.name)) {
      throw new ApkpubError({
        code: ErrorCode.CONFIG_INVALID,
        message: `存在重复的渠道名称: ${ch.name}`,
        retryable: false,
      });
    }
    seen.add(ch.name);
  }

  const candidate = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: model.name,
    applicationId: original.applicationId,
    createTime: original.createTime,
    enableChannel: model.enableChannel,
    channels,
    extension: {
      updateDesc: emptyToUndefined(model.extension.updateDesc),
      apkDir: emptyToUndefined(model.extension.apkDir),
      urls: kvToRecord(model.extension.urls),
      lastVersionCode: kvToNumberRecord(model.extension.lastVersionCode),
      lastVersionName: kvToRecord(model.extension.lastVersionName),
    },
  };

  return validateConfig(candidate);
}

function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(':')[0];
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  } catch {
    return false;
  }
}

function tokenMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2 * 1024 * 1024) {
      throw new ApkpubError({
        code: ErrorCode.CONFIG_INVALID,
        message: '请求体过大',
        retryable: false,
      });
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function openBrowser(url: string): void {
  const os = platform();
  let command: string;
  let args: string[];
  if (os === 'darwin') {
    command = 'open';
    args = [url];
  } else if (os === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      logger.warn('config', `无法自动打开浏览器，请手动访问: ${url}`);
    });
    child.unref();
  } catch {
    logger.warn('config', `无法自动打开浏览器，请手动访问: ${url}`);
  }
}

/** 启动本地配置编辑 Web UI */
export async function runConfigUi(appId: string, options: ConfigUiOptions = {}): Promise<void> {
  await loadConfig(appId);
  const token = randomBytes(24).toString('hex');
  const channelMetas = getChannelMetas();

  const server = createServer((req, res) => {
    handleRequest(req, res, appId, token, channelMetas).catch((err: unknown) => {
      const message = err instanceof ApkpubError ? err.message : String(err);
      sendJson(res, 500, { ok: false, error: { message } });
    });
  });

  let idleTimer: NodeJS.Timeout;
  const resetIdle = (onTimeout: () => void): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(onTimeout, IDLE_TIMEOUT_MS);
    idleTimer.unref();
  };

  await new Promise<void>((resolve, reject) => {
    const shutdown = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      server.close(() => resolve());
    };

    server.on('request', () => resetIdle(shutdown));
    server.on('error', reject);
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const url = `http://127.0.0.1:${port}/?token=${token}`;
      process.stderr.write(`配置编辑页已启动: ${url}\n`);
      process.stderr.write('保存后配置会写入本地文件，编辑完成按 Ctrl+C 退出。\n');
      resetIdle(shutdown);
      if (options.open !== false) openBrowser(url);
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  appId: string,
  token: string,
  channelMetas: ReturnType<typeof getChannelMetas>,
): Promise<void> {
  if (!isLocalHost(req.headers.host)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderConfigUiPage());
    return;
  }

  const requestToken = url.searchParams.get('token') ?? '';
  if (!tokenMatches(token, requestToken)) {
    sendJson(res, 401, { ok: false, error: { message: '无效的访问令牌' } });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/meta') {
    const config = await loadConfig(appId);
    sendJson(res, 200, {
      ok: true,
      model: configToFormModel(config),
      channelMetas,
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/config') {
    if (!isLocalOrigin(req.headers.origin)) {
      sendJson(res, 403, { ok: false, error: { message: '非法的请求来源' } });
      return;
    }
    try {
      const raw = await readBody(req);
      const model = JSON.parse(raw) as FormModel;
      const original = await loadConfig(appId);
      const config = formModelToConfig(model, original);
      await saveConfig(config);
      sendJson(res, 200, { ok: true, model: configToFormModel(config) });
    } catch (err) {
      const message = err instanceof ApkpubError ? err.message : String(err);
      sendJson(res, 400, { ok: false, error: { message } });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: { message: '未找到资源' } });
}
