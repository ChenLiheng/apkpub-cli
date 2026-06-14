import { Command } from 'commander';
import { loadConfig } from '../config/store.js';
import { resolveChannels } from '../channels/registry.js';
import { resolveConfigSecrets } from '../secrets/resolver.js';
import { TaskLauncher } from '../core/TaskLauncher.js';
import { printJson } from '../utils/output.js';
import { setJsonMode } from '../utils/logger.js';
import { ApkpubError } from '../errors/ApkpubError.js';
import { ExitCode } from '../core/result.js';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('体检：校验配置完整性与各渠道凭证可用性')
    .requiredOption('--app <id>', '应用包名')
    .option('--json', 'JSON 格式输出')
    .action(async (options: { app: string; json?: boolean }) => {
      setJsonMode(!!options.json);
      try {
        const appConfig = await loadConfig(options.app);
        const channels = resolveChannels(appConfig);
        const checks: { channel: string; ok: boolean; message: string }[] = [];

        for (const channel of channels) {
          const chConfig = appConfig.channels.find((c) => c.name === channel.name);
          if (!chConfig) {
            checks.push({ channel: channel.name, ok: false, message: `渠道 ${channel.name} 未在配置中启用` });
            continue;
          }
          try {
            const rawParams = TaskLauncher.getRawParams(chConfig);
            const resolved = await resolveConfigSecrets(rawParams);
            if (channel.validateCredentials) {
              await channel.validateCredentials(resolved);
            }
            checks.push({ channel: channel.name, ok: true, message: '凭证有效' });
          } catch (err) {
            checks.push({
              channel: channel.name,
              ok: false,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }

        const allOk = checks.every((c) => c.ok);
        const output = { ok: allOk, app: options.app, checks };
        if (options.json) {
          printJson(output);
        } else {
          for (const c of checks) {
            const icon = c.ok ? '✓' : '✗';
            process.stderr.write(`${icon} [${c.channel}] ${c.message}\n`);
          }
        }
        process.exit(allOk ? ExitCode.SUCCESS : ExitCode.ALL_FAILED);
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
