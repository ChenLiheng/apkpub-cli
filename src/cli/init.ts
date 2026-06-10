import { Command } from 'commander';
import { input, confirm, checkbox } from '@inquirer/prompts';
import { saveConfig, ensureConfigDirs } from '../config/store.js';
import { CURRENT_SCHEMA_VERSION, type AppConfig, type ChannelConfig } from '../config/schema.js';
import { getChannelMetas } from '../channels/registry.js';
import { printJson, isInteractive } from '../utils/output.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { ExitCode } from '../core/result.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('创建应用配置')
    .option('--name <name>', '应用显示名称')
    .option('--app <id>', '应用包名')
    .option('--channels <names>', '启用的市场渠道，逗号分隔')
    .option('--json', 'JSON 格式输出')
    .action(async (options: { name?: string; app?: string; channels?: string; json?: boolean }) => {
      try {
        await ensureConfigDirs();
        let name = options.name;
        let applicationId = options.app;
        let selectedChannels: string[] = options.channels?.split(',').map((s) => s.trim()) ?? [];

        if (isInteractive() && !options.name) {
          name = await input({ message: '应用显示名称:' });
          applicationId = await input({ message: '应用包名 (applicationId):' });
          const metas = getChannelMetas();
          selectedChannels = await checkbox({
            message: '选择要启用的市场渠道:',
            choices: metas.map((m) => ({ name: m.label, value: m.name })),
          });
        }

        if (!name || !applicationId) {
          throw new ApkpubError({
            code: ErrorCode.INVALID_ARGUMENT,
            message: '请提供 --name 和 --app，或在交互模式下运行',
            retryable: false,
          });
        }

        const metas = getChannelMetas();
        const channels: ChannelConfig[] = [];

        for (const meta of metas) {
          const enabled = selectedChannels.length === 0 || selectedChannels.includes(meta.name);
          if (!enabled && selectedChannels.length > 0) continue;
          if (selectedChannels.length > 0 && !selectedChannels.includes(meta.name)) continue;

          if (isInteractive() && (selectedChannels.length === 0 || selectedChannels.includes(meta.name))) {
            const enable = selectedChannels.length > 0
              ? true
              : await confirm({ message: `启用 ${meta.label} 渠道?`, default: false });
            if (!enable) continue;

            const params: { name: string; value: string }[] = [];
            for (const field of meta.credentialFields) {
              if (field.name === 'fileNameIdentify') continue;
              const value = await input({
                message: `${meta.label} - ${field.name}${field.description ? ` (${field.description})` : ''}:`,
              });
              params.push({ name: field.name, value });
            }
            params.push({ name: 'fileNameIdentify', value: meta.fileNameIdentify });
            channels.push({ name: meta.name, type: 'market', enable: true, params });
          } else if (selectedChannels.includes(meta.name)) {
            channels.push({
              name: meta.name,
              type: 'market',
              enable: true,
              params: meta.credentialFields
                .filter((f) => f.name !== 'fileNameIdentify')
                .map((f) => ({ name: f.name, value: `\${${meta.name.toUpperCase()}_${f.name.toUpperCase()}}` })),
            });
          }
        }

        const config: AppConfig = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          name,
          applicationId,
          createTime: Date.now(),
          enableChannel: true,
          channels,
          extension: {},
        };

        await saveConfig(config);

        if (options.json) {
          printJson({ ok: true, config: { applicationId, name, channels: channels.map((c) => c.name) } });
        } else {
          process.stderr.write(`已创建应用配置: ${applicationId}\n`);
          process.stderr.write(`配置文件: ~/.apkpub/apps/${applicationId}.json\n`);
        }
        process.exit(ExitCode.SUCCESS);
      } catch (err) {
        const message = err instanceof ApkpubError ? err.message : String(err);
        if (options.json) {
          printJson({ ok: false, error: { message } });
        } else {
          process.stderr.write(`错误: ${message}\n`);
        }
        process.exit(ExitCode.INVALID_ARGUMENT);
      }
    });
}
