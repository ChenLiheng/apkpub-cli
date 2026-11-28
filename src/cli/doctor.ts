import { Command } from 'commander';
import { loadConfig } from '../config/store.js';
import { runDoctor } from '../core/inspect.js';
import { printJson, exitAfterFlush } from '../utils/output.js';
import { setJsonMode } from '../utils/logger.js';
import { toApkpubError } from '../errors/ApkpubError.js';
import { ExitCode } from '../core/result.js';
import { getErrorExitCode } from './exitCodes.js';

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
        const checks = (await runDoctor(appConfig)).map((r) => ({
          channel: r.name,
          ok: r.ok,
          message: r.ok ? '凭证有效' : (r.error?.message ?? '未知错误'),
        }));

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
        await exitAfterFlush(allOk ? ExitCode.SUCCESS : ExitCode.ALL_FAILED);
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
