import { Command } from 'commander';
import { getChannelMetas } from '../channels/registry.js';
import { printJson } from '../utils/output.js';
import { ExitCode } from '../core/result.js';

const COMMANDS = [
  {
    name: 'init',
    description: '创建应用配置',
    options: [
      { name: '--name', required: false, description: '应用显示名称' },
      { name: '--app', required: false, description: '应用包名' },
      { name: '--channels', required: false, description: '启用的市场渠道' },
    ],
  },
  {
    name: 'publish',
    description: '发布 APK 到指定渠道',
    options: [
      { name: '--app', required: true, description: '应用包名' },
      { name: '--apk', required: true, description: 'APK 文件或目录' },
      { name: '--channels', required: false, description: '渠道列表' },
      { name: '--desc', required: false, description: '更新描述' },
      { name: '--parallel', required: false, description: '并行数' },
      { name: '--dry-run', required: false, description: '仅预检' },
      { name: '--json', required: false, description: 'JSON 输出' },
    ],
  },
  {
    name: 'status',
    description: '查询市场审核状态',
    options: [
      { name: '--app', required: true, description: '应用包名' },
      { name: '--channels', required: false, description: '渠道列表' },
      { name: '--json', required: false, description: 'JSON 输出' },
    ],
  },
  {
    name: 'info',
    description: '解析 APK 信息',
    options: [
      { name: '<apk>', required: true, description: 'APK 文件路径' },
      { name: '--json', required: false, description: 'JSON 输出' },
    ],
  },
  {
    name: 'doctor',
    description: '配置与凭证体检',
    options: [
      { name: '--app', required: true, description: '应用包名' },
      { name: '--json', required: false, description: 'JSON 输出' },
    ],
  },
  {
    name: 'mcp',
    description: '启动 MCP server 模式',
    options: [],
  },
];

export function registerDescribeCommand(program: Command): void {
  program
    .command('describe')
    .description('输出命令与渠道的机器可读清单（供 Agent 自发现）')
    .option('--json', 'JSON 格式输出', true)
    .action((options: { json?: boolean }) => {
      const descriptor = {
        name: 'apkpub-cli',
        version: '1.0.0',
        commands: COMMANDS,
        channels: getChannelMetas(),
        exitCodes: {
          0: '全部成功',
          2: '参数/配置错误',
          3: '版本校验失败',
          4: '部分渠道失败',
          5: '全部失败',
        },
        jsonSchema: {
          publishResult: {
            ok: 'boolean',
            dryRun: 'boolean',
            results: [{ name: 'string', status: 'string', downloadUrl: 'string?', error: 'object?' }],
            summary: { total: 'number', success: 'number', failed: 'number', skipped: 'number' },
          },
        },
      };
      if (options.json !== false) {
        printJson(descriptor);
      }
      process.exit(ExitCode.SUCCESS);
    });
}
