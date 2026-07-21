import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import {
  listConfigs,
  loadConfig,
  importConfig,
  exportConfig,
  saveConfig,
} from '../config/store.js';
import { stripSecrets, type ChannelConfig } from '../config/schema.js';
import { getBuiltinChannels } from '../channels/registry.js';
import { runConfigUi } from './configUi.js';
import { printJson } from '../utils/output.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { ExitCode } from '../core/result.js';

export function registerConfigCommand(program: Command): void {
  const config = program.command('config').description('配置管理');

  config
    .command('list')
    .description('列出所有应用配置')
    .option('--json', 'JSON 格式输出')
    .action(async (options: { json?: boolean }) => {
      const configs = await listConfigs();
      if (options.json) {
        printJson({ apps: configs.map((c) => ({ name: c.name, applicationId: c.applicationId })) });
      } else {
        for (const c of configs) {
          process.stderr.write(`${c.applicationId} - ${c.name}\n`);
        }
      }
      process.exit(ExitCode.SUCCESS);
    });

  config
    .command('get <appId>')
    .description('获取应用配置')
    .option('--json', 'JSON 格式输出')
    .action(async (appId: string, options: { json?: boolean }) => {
      try {
        const cfg = await loadConfig(appId);
        if (options.json) {
          printJson(stripSecrets(cfg));
        } else {
          process.stderr.write(JSON.stringify(stripSecrets(cfg), null, 2) + '\n');
        }
        process.exit(ExitCode.SUCCESS);
      } catch (err) {
        handleError(err, options.json);
      }
    });

  config
    .command('set <appId>')
    .description('设置指定渠道的开关或参数')
    .requiredOption('--channel <name>', '目标渠道名称（如 huawei / honor / mi / oppo / vivo）')
    .option('--enable <bool>', '启用或禁用该渠道（true/false）')
    .option(
      '--param <key=value>',
      '设置渠道参数（可重复传入，如 --param client_id=xxx）',
      collectParam,
      [] as string[],
    )
    .option('--json', 'JSON 格式输出')
    .action(
      async (
        appId: string,
        options: { channel: string; enable?: string; param: string[]; json?: boolean },
      ) => {
        try {
          if (options.enable === undefined && options.param.length === 0) {
            throw new ApkpubError({
              code: ErrorCode.CONFIG_INVALID,
              message: '至少需要指定 --enable 或 --param 中的一项',
              retryable: false,
            });
          }

          const cfg = await loadConfig(appId);
          const channel = resolveOrCreateChannel(cfg.channels, options.channel);

          if (options.enable !== undefined) {
            channel.enable = parseBool(options.enable);
          }

          for (const raw of options.param) {
            const { key, value } = parseParam(raw);
            const existing = channel.params.find((p) => p.name === key);
            if (existing) {
              existing.value = value;
            } else {
              channel.params.push({ name: key, value });
            }
          }

          await saveConfig(cfg);

          if (options.json) {
            printJson({
              ok: true,
              applicationId: cfg.applicationId,
              channel: {
                name: channel.name,
                enable: channel.enable,
                params: stripSecrets(cfg).channels.find((c) => c.name === channel.name)?.params ?? [],
              },
            });
          } else {
            process.stderr.write(`已更新渠道 ${channel.name} 配置\n`);
          }
          process.exit(ExitCode.SUCCESS);
        } catch (err) {
          handleError(err, options.json);
        }
      },
    );

  config
    .command('ui <appId>')
    .description('打开网页可视化编辑应用配置')
    .option('--port <port>', '监听端口（默认随机可用端口）')
    .option('--no-open', '不自动打开浏览器')
    .action(async (appId: string, options: { port?: string; open?: boolean }) => {
      try {
        let port: number | undefined;
        if (options.port !== undefined) {
          port = Number(options.port);
          if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw new ApkpubError({
              code: ErrorCode.INVALID_ARGUMENT,
              message: `无效的端口: ${options.port}`,
              retryable: false,
            });
          }
        }
        await runConfigUi(appId, { port, open: options.open });
        process.exit(ExitCode.SUCCESS);
      } catch (err) {
        handleError(err, false);
      }
    });

  config
    .command('export <appId>')
    .description('导出应用配置（默认剥离密钥）')
    .option('--include-secrets', '包含密钥（不推荐）')
    .option('-o, --output <file>', '输出文件路径')
    .action(async (appId: string, options: { includeSecrets?: boolean; output?: string }) => {
      try {
        const content = await exportConfig(appId, { includeSecrets: options.includeSecrets });
        if (options.output) {
          await writeFile(options.output, content, { mode: 0o600 });
          process.stderr.write(`已导出到 ${options.output}\n`);
        } else {
          process.stdout.write(content + '\n');
        }
        process.exit(ExitCode.SUCCESS);
      } catch (err) {
        handleError(err, false);
      }
    });

  config
    .command('import <file>')
    .description('导入应用配置')
    .action(async (file: string) => {
      try {
        const cfg = await importConfig(file);
        process.stderr.write(`已导入: ${cfg.applicationId}\n`);
        process.exit(ExitCode.SUCCESS);
      } catch (err) {
        handleError(err, false);
      }
    });
}

/** 收集可重复传入的 --param 选项 */
function collectParam(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** 解析布尔字符串 */
function parseBool(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new ApkpubError({
    code: ErrorCode.CONFIG_INVALID,
    message: `无效的布尔值: ${value}（应为 true 或 false）`,
    retryable: false,
  });
}

/** 解析 key=value 形式的参数 */
function parseParam(raw: string): { key: string; value: string } {
  const idx = raw.indexOf('=');
  if (idx <= 0) {
    throw new ApkpubError({
      code: ErrorCode.CONFIG_INVALID,
      message: `无效的参数格式: ${raw}（应为 key=value）`,
      retryable: false,
    });
  }
  return { key: raw.slice(0, idx).trim(), value: raw.slice(idx + 1) };
}

/** 在配置中查找渠道，不存在时若为内置市场渠道则自动创建 */
function resolveOrCreateChannel(
  channels: ChannelConfig[],
  name: string,
): ChannelConfig {
  const existing = channels.find((c) => c.name === name);
  if (existing) return existing;

  const isBuiltinMarket = getBuiltinChannels().some((c) => c.name === name);
  if (!isBuiltinMarket) {
    throw new ApkpubError({
      code: ErrorCode.CHANNEL_NOT_FOUND,
      message: `渠道 "${name}" 未在配置中定义；自定义渠道请先通过 init 创建`,
      retryable: false,
    });
  }

  const created: ChannelConfig = {
    name,
    type: 'market',
    enable: true,
    params: [],
  };
  channels.push(created);
  return created;
}

function handleError(err: unknown, json?: boolean): never {
  const message = err instanceof ApkpubError ? err.message : String(err);
  if (json) {
    printJson({ ok: false, error: { message } });
  } else {
    process.stderr.write(`错误: ${message}\n`);
  }
  process.exit(ExitCode.INVALID_ARGUMENT);
}
