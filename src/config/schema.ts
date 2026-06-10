import { z } from 'zod';

export const CURRENT_SCHEMA_VERSION = 1;

/** 渠道参数 */
export const channelParamSchema = z.object({
  name: z.string(),
  value: z.string().default(''),
});

/** 市场渠道配置 */
export const marketChannelConfigSchema = z.object({
  name: z.string(),
  type: z.literal('market').default('market'),
  enable: z.boolean().default(true),
  params: z.array(channelParamSchema).default([]),
});

/** OSS 认证配置 */
export const ossAuthSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ak'),
    accessKeyId: z.string(),
    accessKeySecret: z.string(),
  }),
  z.object({
    mode: z.literal('sts'),
    stsTokenUrl: z.string().url(),
    signKey: z.string(),
    contextB: z.string().default('{}'),
  }),
]);

/** 自定义渠道配置 */
export const customChannelConfigSchema = z.object({
  name: z.string(),
  type: z.literal('custom'),
  enable: z.boolean().default(true),
  uploadType: z.enum(['oss', 'http']),
  fileNameIdentify: z.string().optional(),
  endpoint: z.string().optional(),
  bucket: z.string().optional(),
  auth: ossAuthSchema.optional(),
  uploadUrl: z.string().optional(),
  method: z.enum(['PUT', 'POST']).optional(),
  headers: z.record(z.string()).optional(),
  formField: z.string().optional(),
  objectKeyTemplate: z.string(),
  downloadUrlTemplate: z.string(),
  params: z.array(channelParamSchema).default([]),
});

export const channelConfigSchema = z.union([marketChannelConfigSchema, customChannelConfigSchema]);

/** 应用扩展信息 */
export const extensionSchema = z.object({
  updateDesc: z.string().optional(),
  apkDir: z.string().optional(),
  urls: z.record(z.string()).optional(),
  lastVersionCode: z.record(z.number()).optional(),
  lastVersionName: z.record(z.string()).optional(),
});

/** 应用配置 */
export const appConfigSchema = z.object({
  schemaVersion: z.number().default(CURRENT_SCHEMA_VERSION),
  name: z.string(),
  applicationId: z.string(),
  createTime: z.number(),
  enableChannel: z.boolean().default(true),
  channels: z.array(channelConfigSchema).default([]),
  extension: extensionSchema.default({}),
});

export type ChannelParam = z.infer<typeof channelParamSchema>;
export type MarketChannelConfig = z.infer<typeof marketChannelConfigSchema>;
export type CustomChannelConfig = z.infer<typeof customChannelConfigSchema>;
export type ChannelConfig = z.infer<typeof channelConfigSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;

/** 从渠道配置提取参数字典 */
export function paramsToRecord(params: ChannelParam[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const p of params) {
    record[p.name] = p.value;
  }
  return record;
}

/** 迁移旧版配置 */
export function migrateConfig(raw: unknown): AppConfig {
  const obj = raw as Record<string, unknown>;
  if (!obj.schemaVersion) {
    obj.schemaVersion = 1;
  }
  return appConfigSchema.parse(obj);
}

/** 剥离敏感字段用于导出 */
export function stripSecrets(config: AppConfig): AppConfig {
  const sensitiveKeys = [
    'client_secret',
    'privateKey',
    'access_key_secret',
    'accessKeySecret',
    'signKey',
    'password',
  ];
  const stripped = structuredClone(config);
  for (const ch of stripped.channels) {
    if ('params' in ch) {
      for (const p of ch.params) {
        if (sensitiveKeys.some((k) => p.name.toLowerCase().includes(k.toLowerCase()))) {
          p.value = '';
        }
      }
    }
    if (ch.type === 'custom' && ch.auth) {
      if (ch.auth.mode === 'ak') {
        ch.auth.accessKeyId = '';
        ch.auth.accessKeySecret = '';
      } else {
        ch.auth.signKey = '';
      }
    }
  }
  return stripped;
}
