import { Command } from 'commander';
import { parseApk } from '../apk/ApkParser.js';
import { printJson } from '../utils/output.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';
import { ExitCode } from '../core/result.js';

export function registerInfoCommand(program: Command): void {
  program
    .command('info <apk>')
    .description('解析 APK，输出包名、版本号等信息')
    .option('--json', 'JSON 格式输出')
    .action(async (apk: string, options: { json?: boolean }) => {
      try {
        const info = await parseApk(apk);
        const output = {
          filePath: info.filePath,
          applicationId: info.applicationId,
          versionCode: info.versionCode,
          versionName: info.versionName,
          size: info.size,
          sizeMB: (info.size / 1024 / 1024).toFixed(2),
        };
        if (options.json) {
          printJson(output);
        } else {
          process.stderr.write(`包名: ${info.applicationId}\n`);
          process.stderr.write(`版本号: ${info.versionCode}\n`);
          process.stderr.write(`版本名: ${info.versionName}\n`);
          process.stderr.write(`大小: ${output.sizeMB} MB\n`);
        }
        process.exit(ExitCode.SUCCESS);
      } catch (err) {
        const message = err instanceof ApkpubError ? err.message : String(err);
        if (options.json) {
          printJson({ ok: false, error: { message, code: err instanceof ApkpubError ? err.code : ErrorCode.INTERNAL } });
        } else {
          process.stderr.write(`错误: ${message}\n`);
        }
        process.exit(ExitCode.INVALID_ARGUMENT);
      }
    });
}
