import { Command } from 'commander';
import { loadConfig } from '../config/store.js';
import { resolveChannels } from '../channels/registry.js';
import { resolveConfigSecrets } from '../secrets/resolver.js';
import { TaskLauncher } from '../core/TaskLauncher.js';
import { printJson, printStatusResults } from '../utils/output.js';
import { setJsonMode } from '../utils/logger.js';
import { ApkpubError } from '../errors/ApkpubError.js';
import { ExitCode } from '../core/result.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('查询各市场线上版本与审核状态')
    .requiredOption('--app <id>', '应用包名')
    .option('--channels <names>', '渠道列表，逗号分隔', (v: string) => v.split(',').map((s) => s.trim()))
    .option('--json', 'JSON 格式输出')
    .action(async (options: { app: string; channels?: string[]; json?: boolean }) => {
      setJsonMode(!!options.json);
      try {
        const appConfig = await loadConfig(options.app);
        const channels = resolveChannels(appConfig, options.channels);
        const results = [];

        for (const channel of channels) {
          if (!channel.getMarketState) {
            results.push({ name: channel.name, label: channel.label, state: 'n/a', error: '自定义渠道无市场状态' });
            continue;
          }
          const chConfig = appConfig.channels.find((c) => c.name === channel.name)!;
          try {
            const rawParams = TaskLauncher.getRawParams(chConfig);
            const resolved = await resolveConfigSecrets(rawParams);
            const state = await channel.getMarketState(appConfig.applicationId, resolved);
            results.push({
              name: channel.name,
              label: channel.label,
              state: state?.reviewState ?? 'unknown',
              versionCode: state?.lastVersionCode,
              versionName: state?.lastVersionName,
            });
          } catch (err) {
            results.push({
              name: channel.name,
              label: channel.label,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        if (options.json) {
          printJson({ ok: true, results });
        } else {
          printStatusResults(results);
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
