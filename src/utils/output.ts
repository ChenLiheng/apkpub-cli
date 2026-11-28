import Table from 'cli-table3';
import pc from 'picocolors';
import type { PublishResult } from '../core/result.js';

/** 等待流中已写入的数据全部交给系统（管道写入在 macOS 等平台是异步的） */
function flushStream(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.destroyed || !stream.writable) {
      resolve();
      return;
    }
    stream.write('', () => resolve());
  });
}

/**
 * 刷新 stdout/stderr 后以指定退出码退出。
 * 直接 process.exit 可能截断尚未写完的 --json 输出，导致管道另一端解析失败。
 */
export async function exitAfterFlush(code: number): Promise<never> {
  process.exitCode = code;
  await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);
  process.exit(code);
}

/** 输出 JSON 到 stdout */
export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/** 打印发布结果表格 */
export function printPublishResult(result: PublishResult): void {
  const table = new Table({
    head: ['渠道', '状态', '下载链接', '错误'],
    colWidths: [12, 10, 40, 30],
  });
  for (const r of result.results) {
    const statusColor =
      r.status === 'success' ? pc.green :
      r.status === 'failed' ? pc.red :
      r.status === 'dry_run' ? pc.yellow : pc.gray;
    table.push([
      r.label,
      statusColor(r.status),
      r.downloadUrl ?? '-',
      r.error?.message ?? '-',
    ]);
  }
  process.stderr.write('\n' + table.toString() + '\n');
  const { summary } = result;
  process.stderr.write(
    pc.dim(`\n总计: ${summary.total} | 成功: ${pc.green(String(summary.success))} | 失败: ${pc.red(String(summary.failed))} | 跳过: ${summary.skipped}\n`),
  );
}

/** 打印渠道状态表格 */
export function printStatusResults(results: { name: string; label: string; state?: string; versionCode?: number; versionName?: string; error?: string }[]): void {
  const table = new Table({
    head: ['渠道', '审核状态', '版本号', '版本名', '备注'],
  });
  for (const r of results) {
    table.push([r.label, r.state ?? '-', r.versionCode ?? '-', r.versionName ?? '-', r.error ?? '-']);
  }
  process.stderr.write('\n' + table.toString() + '\n');
}

/** 判断是否为 TTY */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}
