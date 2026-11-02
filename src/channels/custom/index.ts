import { customChannelConfigSchema, type CustomChannelConfig } from '../../config/schema.js';
import type { Channel } from '../Channel.js';
import { uploadToOss } from './oss.js';
import { uploadToHttp } from './http.js';

const authSchema = customChannelConfigSchema.shape.auth;
const headersSchema = customChannelConfigSchema.shape.headers;

/** 用上传上下文中已解析密钥的 auth/headers 覆盖原始配置 */
export function mergeResolvedConfig(
  config: CustomChannelConfig,
  resolved: Record<string, unknown>,
): CustomChannelConfig {
  const auth = resolved.auth !== undefined ? authSchema.parse(resolved.auth) : config.auth;
  const headers = resolved.headers !== undefined ? headersSchema.parse(resolved.headers) : config.headers;
  return { ...config, auth, headers };
}

/** 从配置创建自定义渠道实例 */
export function createCustomChannel(config: CustomChannelConfig): Channel {
  return {
    name: config.name,
    label: config.name,
    type: 'custom',
    fileNameIdentify: config.fileNameIdentify ?? config.name,
    credentialSchema: customChannelConfigSchema,
    async upload(ctx) {
      const effective = mergeResolvedConfig(config, ctx.config);
      if (effective.uploadType === 'oss') {
        return uploadToOss(ctx, effective);
      }
      return uploadToHttp(ctx, effective);
    },
    async validateCredentials() {
      // 自定义渠道预检：校验必填字段
      customChannelConfigSchema.parse(config);
    },
  };
}
