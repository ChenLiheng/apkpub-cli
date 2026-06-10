import { Command } from 'commander';
import { getChannelMetas } from '../channels/registry.js';
import { printJson } from '../utils/output.js';
import { ExitCode } from '../core/result.js';

export function registerChannelsCommand(program: Command): void {
  program
    .command('channels')
    .description('列出支持的内置市场渠道及所需凭证字段')
    .option('--json', 'JSON 格式输出')
    .action((options: { json?: boolean }) => {
      const metas = getChannelMetas();
      if (options.json) {
        printJson({ channels: metas });
      } else {
        for (const ch of metas) {
          process.stderr.write(`\n${ch.label} (${ch.name})\n`);
          process.stderr.write(`  文件名标识: ${ch.fileNameIdentify}\n`);
          process.stderr.write(`  凭证字段:\n`);
          for (const f of ch.credentialFields) {
            process.stderr.write(`    - ${f.name}${f.required ? ' *' : ''}: ${f.description ?? ''}\n`);
          }
        }
        process.stderr.write('\n');
      }
      process.exit(ExitCode.SUCCESS);
    });
}
