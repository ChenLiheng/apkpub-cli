import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import {
  listConfigs,
  loadConfig,
  importConfig,
  exportConfig,
} from '../config/store.js';
import { stripSecrets } from '../config/schema.js';
import { printJson } from '../utils/output.js';
import { ApkpubError } from '../errors/ApkpubError.js';
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

function handleError(err: unknown, json?: boolean): never {
  const message = err instanceof ApkpubError ? err.message : String(err);
  if (json) {
    printJson({ ok: false, error: { message } });
  } else {
    process.stderr.write(`错误: ${message}\n`);
  }
  process.exit(ExitCode.INVALID_ARGUMENT);
}
