import { getChannelMetas } from '../channels/registry.js';
import { ExitCode } from '../core/result.js';
import { ErrorCode } from '../errors/ApkpubError.js';
import { PACKAGE_VERSION } from '../version.js';

const COMMANDS = [
  {
    name: 'init',
    description: '创建应用配置',
    options: [
      { name: '--name', required: false, description: '应用显示名称' },
      { name: '--app', required: false, description: '应用包名' },
      { name: '--apk', required: false, description: '从 APK 自动读取应用包名' },
      { name: '--channels', required: false, description: '启用的市场渠道' },
      { name: '--json', required: false, description: 'JSON 输出' },
    ],
  },
  {
    name: 'publish',
    description: '发布 APK 到指定渠道',
    options: [
      { name: '--app', required: true, description: '应用包名' },
      { name: '--apk', required: true, description: 'APK 文件或目录' },
      { name: '--channels', required: false, description: '渠道列表' },
      { name: '--desc', required: false, description: '更新描述；配置中未设置 extension.updateDesc 时必填（dry-run 同样）' },
      { name: '--parallel', required: false, description: '并行数' },
      { name: '--dry-run', required: false, description: '仅预检' },
      { name: '--yes', required: false, description: '跳过交互确认（仅终端交互模式下会提示确认）' },
      { name: '--json', required: false, description: 'JSON 输出' },
      { name: '--no-progress', required: false, description: '禁用进度显示' },
      { name: '--debug', required: false, description: '调试模式：在 stderr 输出调试日志' },
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
  {
    name: 'skill',
    description: '管理随包发布的 Agent skill：install [--force] [--all] / status / uninstall [--force]',
    options: [
      { name: '--force', required: false, description: 'install：覆盖被修改过的文件（先备份）；uninstall：同时删除被修改过的文件' },
      { name: '--all', required: false, description: 'install：为所有支持的 Agent 安装，即使未检测到' },
      { name: '--json', required: false, description: 'JSON 输出' },
    ],
  },
];

const AGENT_WORKFLOW = [
  'apkpub_describe 或 apkpub describe --json',
  'apkpub_info 或 apkpub info <apk> --json',
  'apkpub_doctor 或 apkpub doctor --app <id> --json（CONFIG_NOT_FOUND 时先运行 apkpub init --name <名称> --app <id> --channels <渠道> --json）',
  'apkpub_status 或 apkpub status --app <id> --json',
  'apkpub_publish dryRun=true 或 apkpub publish --app <id> --apk <path> --desc <描述> --dry-run --json --yes',
  '向用户确认版本、渠道与更新描述（正式发布提交到市场后无法撤回）',
  'apkpub_publish dryRun=false 或 apkpub publish --app <id> --apk <path> --desc <描述> --json --yes --no-progress',
];

function defaultEnvName(channel: string, field: string): string {
  return `${channel.toUpperCase()}_${field.toUpperCase()}`;
}

/** 构建 Agent/CLI 共享能力描述 */
export function buildDescriptor(): Record<string, unknown> {
  const channels = getChannelMetas().map((channel) => ({
    ...channel,
    credentialFields: channel.credentialFields.map((field) => ({
      ...field,
      env: field.name === 'fileNameIdentify' ? undefined : defaultEnvName(channel.name, field.name),
    })),
  }));

  return {
    name: 'apkpub-cli',
    version: PACKAGE_VERSION,
    commands: COMMANDS,
    channels,
    agentWorkflow: AGENT_WORKFLOW,
    exitCodes: {
      [ExitCode.SUCCESS]: '全部成功',
      [ExitCode.INTERNAL]: '内部错误',
      [ExitCode.INVALID_ARGUMENT]: '参数/配置/密钥错误',
      [ExitCode.VERSION_CHECK_FAILED]: '版本校验失败',
      [ExitCode.PARTIAL_FAILURE]: '部分渠道失败（publish / status）',
      [ExitCode.ALL_FAILED]: '全部失败（publish / status；doctor 存在未通过渠道）',
      [ExitCode.CANCELLED]: '用户取消（publish 确认提示选择否，或再次 Ctrl+C 强制退出）',
    },
    errorCodes: Object.values(ErrorCode),
    jsonSchema: {
      publishResult: {
        ok: 'boolean',
        dryRun: 'boolean',
        results: [{ name: 'string', status: 'string', downloadUrl: 'string?', error: 'object?' }],
        summary: { total: 'number', success: 'number', failed: 'number', skipped: 'number' },
      },
    },
  };
}
