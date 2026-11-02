import { Command } from 'commander';
import { loadConfig } from '../config/store.js';
import { Dispatcher } from '../core/Dispatcher.js';
import { getExitCode, ExitCode } from '../core/result.js';
import { resolveChannels } from '../channels/registry.js';
import { printJson, printPublishResult, isInteractive } from '../utils/output.js';
import { setJsonMode } from '../utils/logger.js';
import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

function getErrorExitCode(err: ApkpubError): ExitCode {
  switch (err.code) {
    case ErrorCode.VERSION_TOO_LOW:
      return ExitCode.VERSION_CHECK_FAILED;
    case ErrorCode.INVALID_ARGUMENT:
    case ErrorCode.CONFIG_NOT_FOUND:
    case ErrorCode.CONFIG_INVALID:
    case ErrorCode.APK_NOT_FOUND:
    case ErrorCode.APK_AMBIGUOUS:
    case ErrorCode.CHANNEL_NOT_FOUND:
      return ExitCode.INVALID_ARGUMENT;
    default:
      return ExitCode.INTERNAL;
  }
}

/** 解析 --parallel：未传值时按渠道数全并行，非正整数视为参数错误 */
export function parseParallel(raw: string | boolean | undefined, channelCount: number): number {
  if (raw === undefined) return 1;
  if (raw === true) return Math.max(1, channelCount);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ApkpubError({
      code: ErrorCode.INVALID_ARGUMENT,
      message: `--parallel 必须为正整数，当前为「${String(raw)}」`,
      retryable: false,
    });
  }
  return value;
}

/** 监听 SIGINT/SIGTERM：首次触发取消发布，再次触发强制退出 */
function createInterruptController(): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onSignal = (): void => {
    if (controller.signal.aborted) {
      process.exit(130);
    }
    process.stderr.write('\n收到中断信号，正在取消发布（再次按 Ctrl+C 强制退出）...\n');
    controller.abort();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return {
    signal: controller.signal,
    dispose: () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    },
  };
}

export function registerPublishCommand(program: Command): void {
  program
    .command('publish')
    .description('发布 APK 到指定渠道')
    .requiredOption('--app <id>', '应用包名')
    .requiredOption('--apk <path>', 'APK 文件或目录路径')
    .option('--channels <names>', '渠道列表，逗号分隔', (v: string) => v.split(',').map((s) => s.trim()))
    .option('--desc <text>', '更新描述')
    .option('--parallel [n]', '并行上传数', '1')
    .option('--dry-run', '仅预检，不实际上传')
    .option('--yes', '跳过确认')
    .option('--json', 'JSON 格式输出')
    .option('--no-progress', '禁用进度显示')
    .option('--debug', '调试模式')
    .action(async (options: {
      app: string;
      apk: string;
      channels?: string[];
      desc?: string;
      parallel?: string | boolean;
      dryRun?: boolean;
      yes?: boolean;
      json?: boolean;
      progress?: boolean;
      debug?: boolean;
    }) => {
      const jsonMode = options.json || !isInteractive();
      setJsonMode(jsonMode);

      try {
        const appConfig = await loadConfig(options.app);
        const updateDesc = options.desc ?? appConfig.extension.updateDesc ?? '';
        if (!updateDesc.trim()) {
          throw new ApkpubError({
            code: ErrorCode.INVALID_ARGUMENT,
            message: '请通过 --desc 提供更新描述',
            retryable: false,
          });
        }

        const channelNames = options.channels;
        const channels = resolveChannels(appConfig, channelNames);
        if (channels.length === 0) {
          throw new ApkpubError({
            code: ErrorCode.CHANNEL_NOT_FOUND,
            message: '没有可用的发布渠道',
            retryable: false,
          });
        }

        const parallel = parseParallel(options.parallel, channels.length);
        const interrupt = createInterruptController();
        const dispatcher = new Dispatcher();
        const result = await dispatcher.dispatch({
          appConfig,
          channels,
          apkPath: options.apk,
          updateDesc: updateDesc.trim(),
          dryRun: options.dryRun,
          parallel,
          signal: interrupt.signal,
          onChannelProgress: (channel, step, percent) => {
            if (!jsonMode && options.progress !== false) {
              const pct = percent !== undefined ? ` ${percent}%` : '';
              process.stderr.write(`[${channel}] ${step}${pct}\n`);
            }
          },
        }).finally(() => interrupt.dispose());

        if (jsonMode) {
          printJson(result);
        } else {
          printPublishResult(result);
        }
        process.exit(getExitCode(result));
      } catch (err) {
        const apkErr = err instanceof ApkpubError ? err : new ApkpubError({ code: ErrorCode.INTERNAL, message: String(err) });
        if (jsonMode) {
          printJson({ ok: false, error: { code: apkErr.code, message: apkErr.message, retryable: apkErr.retryable } });
        } else {
          process.stderr.write(`错误: ${apkErr.message}\n`);
        }
        process.exit(getErrorExitCode(apkErr));
      }
    });
}
