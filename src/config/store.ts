import { mkdir, readFile, readdir, writeFile, chmod, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { appConfigSchema, migrateConfig, stripSecrets, type AppConfig } from './schema.js';
import { logger } from '../utils/logger.js';

const CONFIG_DIR_NAME = '.apkpub';

/** 获取配置根目录 */
export function getConfigRoot(debug = false): string {
  const base = path.join(os.homedir(), CONFIG_DIR_NAME);
  return debug ? path.join(base, 'debug') : base;
}

/** 获取应用配置目录 */
export function getAppsDir(debug = false): string {
  return path.join(getConfigRoot(debug), 'apps');
}

/** 获取日志目录 */
export function getLogsDir(debug = false): string {
  return path.join(getConfigRoot(debug), 'logs');
}

/** 确保配置目录存在并设置权限 */
export async function ensureConfigDirs(debug = false): Promise<void> {
  const root = getConfigRoot(debug);
  const apps = getAppsDir(debug);
  const logs = getLogsDir(debug);
  await mkdir(apps, { recursive: true, mode: 0o700 });
  await mkdir(logs, { recursive: true, mode: 0o700 });
  try {
    await chmod(root, 0o700);
  } catch {
    // 目录可能已存在
  }
  await checkPermissions(root);
}

async function checkPermissions(dir: string): Promise<void> {
  try {
    const { statSync } = await import('node:fs');
    const mode = statSync(dir).mode & 0o777;
    if (mode > 0o700) {
      logger.warn('config', `配置目录权限过宽 (${mode.toString(8)})，建议 chmod 700 ${dir}`);
    }
  } catch {
    // 忽略
  }
}

function configPath(applicationId: string, debug = false): string {
  const safe = applicationId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(getAppsDir(debug), `${safe}.json`);
}

/** 保存应用配置 */
export async function saveConfig(config: AppConfig, debug = false): Promise<void> {
  await ensureConfigDirs(debug);
  const filePath = configPath(config.applicationId, debug);
  const content = JSON.stringify(config, null, 2);
  await writeFile(filePath, content, { mode: 0o600 });
  logger.debug('config', `已保存配置: ${filePath}`);
}

/** 读取应用配置 */
export async function loadConfig(applicationId: string, debug = false): Promise<AppConfig> {
  const filePath = configPath(applicationId, debug);
  try {
    await access(filePath);
  } catch {
    throw new ApkpubError({
      code: ErrorCode.CONFIG_NOT_FOUND,
      message: `未找到应用配置: ${applicationId}`,
      retryable: false,
    });
  }
  const content = await readFile(filePath, 'utf8');
  const raw = JSON.parse(content) as unknown;
  return migrateConfig(raw);
}

/** 列出所有应用配置 */
export async function listConfigs(debug = false): Promise<AppConfig[]> {
  await ensureConfigDirs(debug);
  const dir = getAppsDir(debug);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const results = await Promise.all(
    files
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => {
        try {
          const content = await readFile(path.join(dir, file), 'utf8');
          return migrateConfig(JSON.parse(content));
        } catch (err) {
          logger.warn('config', `跳过无效配置 ${file}: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      }),
  );
  return results.filter((c): c is AppConfig => c !== null);
}

/** 导入配置 */
export async function importConfig(filePath: string, debug = false): Promise<AppConfig> {
  const content = await readFile(filePath, 'utf8');
  const raw = JSON.parse(content) as unknown;
  const config = migrateConfig(raw);
  await saveConfig(config, debug);
  return config;
}

/** 导出配置（默认剥离密钥） */
export async function exportConfig(
  applicationId: string,
  options: { includeSecrets?: boolean; debug?: boolean } = {},
): Promise<string> {
  const config = await loadConfig(applicationId, options.debug);
  const output = options.includeSecrets ? config : stripSecrets(config);
  return JSON.stringify(output, null, 2);
}

/** 校验配置 */
export function validateConfig(config: unknown): AppConfig {
  try {
    return appConfigSchema.parse(config);
  } catch (err) {
    throw new ApkpubError({
      code: ErrorCode.CONFIG_INVALID,
      message: `配置校验失败: ${err instanceof Error ? err.message : String(err)}`,
      retryable: false,
      cause: err,
    });
  }
}

/** 写入审计日志 */
export async function writeAuditLog(
  entry: { action: string; appId: string; channels: string[]; versionCode?: number; result: string },
  debug = false,
): Promise<void> {
  await ensureConfigDirs(debug);
  const logFile = path.join(getLogsDir(debug), 'audit.log');
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
  const { appendFile } = await import('node:fs/promises');
  await appendFile(logFile, line, { mode: 0o600 });
}
