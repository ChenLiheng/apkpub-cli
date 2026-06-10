import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { parseApk } from '../apk/ApkParser.js';
import { loadConfig } from '../config/store.js';
import { Dispatcher } from '../core/Dispatcher.js';
import { resolveChannels } from '../channels/registry.js';
import { resolveConfigSecrets } from '../secrets/resolver.js';
import { TaskLauncher } from '../core/TaskLauncher.js';

/** 启动 MCP Server */
export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: 'apkpub-cli', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'apkpub_info',
        description: '解析 APK 文件，获取包名、版本号等信息',
        inputSchema: {
          type: 'object',
          properties: { apk: { type: 'string', description: 'APK 文件路径' } },
          required: ['apk'],
        },
      },
      {
        name: 'apkpub_status',
        description: '查询应用在各市场的审核状态与线上版本',
        inputSchema: {
          type: 'object',
          properties: {
            app: { type: 'string', description: '应用包名' },
            channels: { type: 'array', items: { type: 'string' }, description: '渠道列表' },
          },
          required: ['app'],
        },
      },
      {
        name: 'apkpub_publish',
        description: '发布 APK 到指定渠道',
        inputSchema: {
          type: 'object',
          properties: {
            app: { type: 'string', description: '应用包名' },
            apk: { type: 'string', description: 'APK 文件或目录路径' },
            channels: { type: 'array', items: { type: 'string' }, description: '渠道列表' },
            desc: { type: 'string', description: '更新描述' },
            dryRun: { type: 'boolean', description: '仅预检' },
            parallel: { type: 'number', description: '并行数' },
          },
          required: ['app', 'apk'],
        },
      },
      {
        name: 'apkpub_doctor',
        description: '体检应用配置与各渠道凭证',
        inputSchema: {
          type: 'object',
          properties: { app: { type: 'string', description: '应用包名' } },
          required: ['app'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case 'apkpub_info': {
          const info = await parseApk(params.apk as string);
          return { content: [{ type: 'text', text: JSON.stringify(info) }] };
        }
        case 'apkpub_status': {
          const appConfig = await loadConfig(params.app as string);
          const channels = resolveChannels(appConfig, params.channels as string[] | undefined);
          const results = [];
          for (const channel of channels) {
            if (!channel.getMarketState) {
              results.push({ channel: channel.name, state: 'n/a' });
              continue;
            }
            const chConfig = appConfig.channels.find((c) => c.name === channel.name)!;
            const rawParams = TaskLauncher.getRawParams(chConfig);
            const resolved = await resolveConfigSecrets(rawParams);
            const state = await channel.getMarketState(appConfig.applicationId, resolved);
            results.push({ channel: channel.name, ...state });
          }
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, results }) }] };
        }
        case 'apkpub_publish': {
          const appConfig = await loadConfig(params.app as string);
          const channels = resolveChannels(appConfig, params.channels as string[] | undefined);
          const dispatcher = new Dispatcher();
          const result = await dispatcher.dispatch({
            appConfig,
            channels,
            apkPath: params.apk as string,
            updateDesc: (params.desc as string) ?? appConfig.extension.updateDesc ?? '',
            dryRun: params.dryRun as boolean | undefined,
            parallel: (params.parallel as number) ?? 1,
          });
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
        case 'apkpub_doctor': {
          const appConfig = await loadConfig(params.app as string);
          const channels = resolveChannels(appConfig);
          const checks = [];
          for (const channel of channels) {
            const chConfig = appConfig.channels.find((c) => c.name === channel.name)!;
            try {
              const rawParams = TaskLauncher.getRawParams(chConfig);
              const resolved = await resolveConfigSecrets(rawParams);
              if (channel.validateCredentials) await channel.validateCredentials(resolved);
              checks.push({ channel: channel.name, ok: true });
            } catch (err) {
              checks.push({ channel: channel.name, ok: false, error: String(err) });
            }
          }
          return { content: [{ type: 'text', text: JSON.stringify({ ok: checks.every((c) => c.ok), checks }) }] };
        }
        default:
          return { content: [{ type: 'text', text: JSON.stringify({ error: `未知工具: ${name}` }) }], isError: true };
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
