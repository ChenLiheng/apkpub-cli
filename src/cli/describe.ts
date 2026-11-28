import { Command } from 'commander';
import { printJson, exitAfterFlush } from '../utils/output.js';
import { ExitCode } from '../core/result.js';
import { buildDescriptor } from './descriptor.js';

export function registerDescribeCommand(program: Command): void {
  program
    .command('describe')
    .description('输出命令与渠道的机器可读清单（供 Agent 自发现）')
    .option('--json', 'JSON 格式输出', true)
    .action(async (options: { json?: boolean }) => {
      const descriptor = buildDescriptor();
      if (options.json !== false) {
        printJson(descriptor);
      }
      await exitAfterFlush(ExitCode.SUCCESS);
    });
}
