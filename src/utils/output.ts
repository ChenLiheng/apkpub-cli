import Table from 'cli-table3';
import pc from 'picocolors';
import type { PublishResult } from '../core/result.js';

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
