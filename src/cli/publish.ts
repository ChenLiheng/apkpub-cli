import { Command } from 'commander';
import path from 'node:path';
import { confirm } from '@inquirer/prompts';
import pc from 'picocolors';
import { loadConfig } from '../config/store.js';
import { Dispatcher } from '../core/Dispatcher.js';
import { getExitCode, ExitCode } from '../core/result.js';
import { preparePublishInputs } from '../core/preflight.js';
import type { Channel } from '../channels/Channel.js';
import { printJson, printPublishResult, isInteractive, exitAfterFlush } from '../utils/output.js';
import { setDebugMode, setJsonMode } from '../utils/logger.js';
import { ApkpubError, ErrorCode, toApkpubError } from '../errors/ApkpubError.js';
import { getErrorExitCode } from './exitCodes.js';

/** 交互模式下展示发布摘要并请求确认；Ctrl+C 退出提示视为取消 */
async function confirmPublish(summary: {
  app: string;
  apk: string;
  channels: Channel[];
  desc: string;
}): Promise<boolean> {
  process.stderr.write(
    [
      '',
      pc.bold('即将发布：'),
      `  应用: ${summary.app}`,
      `  APK:  ${path.resolve(summary.apk)}`,
      `  渠道: ${summary.channels.map((c) => c.label).join('、')}`,
      `  描述: ${summary.desc}`,
      '',
    ].join('\n'),
  );
  try {
    return await confirm({ message: '确认提交到以上渠道？', default: false }, { output: process.stderr });
  } catch {
    return false;
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
      process.exit(ExitCode.CANCELLED);
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
      setDebugMode(!!options.debug);

      try {
        const appConfig = await loadConfig(options.app);
        const { channels, updateDesc } = preparePublishInputs(appConfig, {
          channels: options.channels,
          desc: options.desc,
        });
        const parallel = parseParallel(options.parallel, channels.length);

        // 仅在人工交互（非 JSON、非 dry-run）且未传 --yes 时二次确认；CI / Agent 场景无 TTY，不受影响
        if (!jsonMode && !options.dryRun && !options.yes) {
          const confirmed = await confirmPublish({ app: options.app, apk: options.apk, channels, desc: updateDesc });
          if (!confirmed) {
            process.stderr.write('已取消发布\n');
            // 与成功区分开，避免脚本误以为已发布
            await exitAfterFlush(ExitCode.CANCELLED);
          }
        }

        const interrupt = createInterruptController();
        const dispatcher = new Dispatcher();
        const result = await dispatcher.dispatch({
          appConfig,
          channels,
          apkPath: options.apk,
          updateDesc,
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
        await exitAfterFlush(getExitCode(result));
      } catch (err) {
        const apkErr = toApkpubError(err);
        if (jsonMode) {
          printJson({ ok: false, error: { code: apkErr.code, message: apkErr.message, retryable: apkErr.retryable } });
        } else {
          process.stderr.write(`错误: ${apkErr.message}\n`);
        }
        await exitAfterFlush(getErrorExitCode(apkErr));
      }
    });
}
