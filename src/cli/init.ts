import { Command } from 'commander';
import { input, confirm, checkbox, password } from '@inquirer/prompts';
import { saveConfig, ensureConfigDirs } from '../config/store.js';
import { CURRENT_SCHEMA_VERSION, type AppConfig, type ChannelConfig } from '../config/schema.js';
import { getChannelMetas, type ChannelMeta } from '../channels/registry.js';
import { printJson, isInteractive } from '../utils/output.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { ExitCode } from '../core/result.js';
import { parseApk, type ApkInfo } from '../apk/ApkParser.js';

type ApkParser = (apkPath: string) => Promise<ApkInfo>;

function envVarName(channelName: string, fieldName: string): string {
  return `${channelName.toUpperCase()}_${fieldName.toUpperCase()}`;
}

export function buildMarketChannelConfigs(metas: ChannelMeta[], selectedChannels: string[]): ChannelConfig[] {
  return metas
    .filter((meta) => selectedChannels.includes(meta.name))
    .map((meta) => ({
      name: meta.name,
      type: 'market',
      enable: true,
      params: meta.credentialFields.map((field) => ({
        name: field.name,
        value: field.name === 'fileNameIdentify'
          ? meta.fileNameIdentify
          : `\${${envVarName(meta.name, field.name)}}`,
      })),
    }));
}

function getRequiredEnvVars(channels: ChannelConfig[]): string[] {
  const vars: string[] = [];
  for (const channel of channels) {
    if (channel.type !== 'market') continue;
    for (const param of channel.params) {
      const match = param.value.match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/);
      if (match) vars.push(match[1]);
    }
  }
  return vars;
}

export async function resolveInitApplicationId(
  app?: string,
  apk?: string,
  parser: ApkParser = parseApk,
): Promise<string | undefined> {
  if (app || !apk) return app;
  const apkInfo = await parser(apk);
  return apkInfo.applicationId;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('创建应用配置')
    .option('--name <name>', '应用显示名称')
    .option('--app <id>', '应用包名')
    .option('--apk <path>', '从 APK 自动读取应用包名')
    .option('--channels <names>', '启用的市场渠道，逗号分隔')
    .option('--json', 'JSON 格式输出')
    .action(async (options: { name?: string; app?: string; apk?: string; channels?: string; json?: boolean }) => {
      try {
        await ensureConfigDirs();
        let name = options.name;
        let applicationId = await resolveInitApplicationId(options.app, options.apk);
        let selectedChannels: string[] = options.channels?.split(',').map((s) => s.trim()) ?? [];

        if (isInteractive() && !options.name) {
          name = await input({ message: '应用显示名称:' });
          applicationId = applicationId ?? await input({ message: '应用包名 (applicationId):' });
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
              const message = `${meta.label} - ${field.name}${field.description ? ` (${field.description})` : ''}:`;
              const value = await password({ message, mask: '*' });
              params.push({ name: field.name, value });
            }
            params.push({ name: 'fileNameIdentify', value: meta.fileNameIdentify });
            channels.push({ name: meta.name, type: 'market', enable: true, params });
          }
        }

        if (!isInteractive()) {
          channels.push(...buildMarketChannelConfigs(metas, selectedChannels));
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
          const requiredEnv = getRequiredEnvVars(channels);
          printJson({
            ok: true,
            config: { applicationId, name, channels: channels.map((c) => c.name) },
            nextSteps: {
              requiredEnv,
              doctor: `apkpub doctor --app ${applicationId} --json`,
              dryRun: `apkpub publish --app ${applicationId} --apk <apk-path> --dry-run --json --yes`,
            },
          });
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
