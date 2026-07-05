import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { parseApk } from '../apk/ApkParser.js';
import { loadConfig } from '../config/store.js';
import { Dispatcher } from '../core/Dispatcher.js';
import { resolveChannels } from '../channels/registry.js';
import { resolveConfigSecrets } from '../secrets/resolver.js';
import { TaskLauncher } from '../core/TaskLauncher.js';
import { buildDescriptor } from '../cli/descriptor.js';
import { PACKAGE_VERSION } from '../version.js';

const infoSchema = z.object({ apk: z.string().min(1) });
const statusSchema = z.object({ app: z.string().min(1), channels: z.array(z.string()).optional() });
const publishSchema = z.object({
  app: z.string().min(1),
  apk: z.string().min(1),
  channels: z.array(z.string()).optional(),
  desc: z.string().optional(),
  dryRun: z.boolean().optional(),
  parallel: z.number().int().positive().optional(),
});
const doctorSchema = z.object({ app: z.string().min(1) });

export function createMcpJsonResponse(data: unknown): {
  content: { type: 'text'; text: string }[];
  structuredContent: unknown;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export function buildMcpTools(): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}[] {
  return [
    {
      name: 'apkpub_describe',
      description: '输出 apkpub 命令、渠道、退出码与 Agent 推荐工作流',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
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
  ];
}

/** 启动 MCP Server */
export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: 'apkpub-cli', version: PACKAGE_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: buildMcpTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case 'apkpub_describe': {
          const descriptor = buildDescriptor();
          return createMcpJsonResponse(descriptor);
        }
        case 'apkpub_info': {
          const { apk } = infoSchema.parse(params);
          const info = await parseApk(apk);
          return createMcpJsonResponse(info);
        }
        case 'apkpub_status': {
          const { app, channels: channelNames } = statusSchema.parse(params);
          const appConfig = await loadConfig(app);
          const channels = resolveChannels(appConfig, channelNames);
          const results = [];
          for (const channel of channels) {
            if (!channel.getMarketState) {
              results.push({ channel: channel.name, state: 'n/a' });
              continue;
            }
            const chConfig = appConfig.channels.find((c) => c.name === channel.name);
            if (!chConfig) {
              results.push({ channel: channel.name, error: `渠道 ${channel.name} 未在配置中启用` });
              continue;
            }
            const rawParams = TaskLauncher.getRawParams(chConfig);
            const resolved = await resolveConfigSecrets(rawParams);
            const state = await channel.getMarketState(appConfig.applicationId, resolved);
            results.push({ channel: channel.name, ...state });
          }
          const output = { ok: true, results };
          return createMcpJsonResponse(output);
        }
        case 'apkpub_publish': {
          const { app, apk, channels: channelNames, desc, dryRun, parallel } = publishSchema.parse(params);
          const appConfig = await loadConfig(app);
          const channels = resolveChannels(appConfig, channelNames);
          const dispatcher = new Dispatcher();
          const result = await dispatcher.dispatch({
            appConfig,
            channels,
            apkPath: apk,
            updateDesc: desc ?? appConfig.extension.updateDesc ?? '',
            dryRun,
            parallel: parallel ?? 1,
          });
          return createMcpJsonResponse(result);
        }
        case 'apkpub_doctor': {
          const { app } = doctorSchema.parse(params);
          const appConfig = await loadConfig(app);
          const channels = resolveChannels(appConfig);
          const checks = [];
          for (const channel of channels) {
            const chConfig = appConfig.channels.find((c) => c.name === channel.name);
            if (!chConfig) {
              checks.push({ channel: channel.name, ok: false, error: `渠道 ${channel.name} 未在配置中启用` });
              continue;
            }
            try {
              const rawParams = TaskLauncher.getRawParams(chConfig);
              const resolved = await resolveConfigSecrets(rawParams);
              if (channel.validateCredentials) await channel.validateCredentials(resolved);
              checks.push({ channel: channel.name, ok: true });
            } catch (err) {
              checks.push({ channel: channel.name, ok: false, error: String(err) });
            }
          }
          const output = { ok: checks.every((c) => c.ok), checks };
          return createMcpJsonResponse(output);
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
