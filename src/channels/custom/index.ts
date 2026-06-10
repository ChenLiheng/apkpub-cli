import { customChannelConfigSchema, type CustomChannelConfig } from '../../config/schema.js';
import type { Channel } from '../Channel.js';
import { uploadToOss } from './oss.js';
import { uploadToHttp } from './http.js';

/** 从配置创建自定义渠道实例 */
export function createCustomChannel(config: CustomChannelConfig): Channel {
  return {
    name: config.name,
    label: config.name,
    type: 'custom',
    fileNameIdentify: config.fileNameIdentify ?? config.name,
    credentialSchema: customChannelConfigSchema,
    async upload(ctx) {
      if (config.uploadType === 'oss') {
        return uploadToOss(ctx, config);
      }
      return uploadToHttp(ctx, config);
    },
    async validateCredentials() {
      // 自定义渠道预检：校验必填字段
      customChannelConfigSchema.parse(config);
    },
  };
}
