import { Command } from 'commander';
import { registerInitCommand } from '../cli/init.js';
import { registerConfigCommand } from '../cli/config.js';
import { registerInfoCommand } from '../cli/info.js';
import { registerPublishCommand } from '../cli/publish.js';
import { registerStatusCommand } from '../cli/status.js';
import { registerChannelsCommand } from '../cli/channels.js';
import { registerDoctorCommand } from '../cli/doctor.js';
import { registerDescribeCommand } from '../cli/describe.js';
import { registerMcpCommand } from '../cli/mcp.js';
import { autoSyncSkill, registerSkillCommand } from '../cli/skill.js';
import { renderBanner } from '../cli/banner.js';
import { PACKAGE_VERSION } from '../version.js';

const program = new Command();

program
  .name('apkpub')
  .description('APK 多市场分发 CLI 工具')
  .version(PACKAGE_VERSION)
  // 仅根命令 --help 展示 Banner，子命令帮助不受影响
  .addHelpText('before', () => renderBanner());

registerInitCommand(program);
registerConfigCommand(program);
registerInfoCommand(program);
registerPublishCommand(program);
registerStatusCommand(program);
registerChannelsCommand(program);
registerDoctorCommand(program);
registerDescribeCommand(program);
registerMcpCommand(program);
registerSkillCommand(program);

const argv = process.argv[2] === '--'
  ? [process.argv[0] ?? 'node', process.argv[1] ?? 'apkpub', ...process.argv.slice(3)]
  : process.argv;

async function main(): Promise<void> {
  // skill 子命令自行处理安装，其余命令启动前按需同步（版本一致时只读几个小文件）
  if (argv[2] !== 'skill') await autoSyncSkill();
  await program.parseAsync(argv);
}

main().catch((err: unknown) => {
  process.stderr.write(`致命错误: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
