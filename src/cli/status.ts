import { Command } from 'commander';
import { loadConfig } from '../config/store.js';
import { queryMarketStatus } from '../core/inspect.js';
import { printJson, printStatusResults, exitAfterFlush } from '../utils/output.js';
import { setJsonMode } from '../utils/logger.js';
import { toApkpubError } from '../errors/ApkpubError.js';
import { ExitCode } from '../core/result.js';
import { getErrorExitCode } from './exitCodes.js';

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
        const statuses = await queryMarketStatus(appConfig, options.channels);
        const results = statuses.map((r) =>
          r.unsupported
            ? { name: r.name, label: r.label, state: 'n/a', error: '自定义渠道无市场状态' }
            : r.ok
              ? {
                  name: r.name,
                  label: r.label,
                  state: r.state?.reviewState ?? 'unknown',
                  versionCode: r.state?.lastVersionCode,
                  versionName: r.state?.lastVersionName,
                }
              : { name: r.name, label: r.label, error: r.error?.message },
        );

        // 只统计支持市场查询的渠道：全部失败 → 5，部分失败 → 4
        const queried = statuses.filter((r) => !r.unsupported);
        const failed = queried.filter((r) => !r.ok).length;
        const exitCode =
          failed === 0
            ? ExitCode.SUCCESS
            : failed === queried.length
              ? ExitCode.ALL_FAILED
              : ExitCode.PARTIAL_FAILURE;

        if (options.json) {
          printJson({ ok: failed === 0, results });
        } else {
          printStatusResults(results);
        }
        await exitAfterFlush(exitCode);
      } catch (err) {
        const apkErr = toApkpubError(err);
        if (options.json) {
          printJson({ ok: false, error: { code: apkErr.code, message: apkErr.message } });
        } else {
          process.stderr.write(`错误: ${apkErr.message}\n`);
        }
        await exitAfterFlush(getErrorExitCode(apkErr));
      }
    });
}
