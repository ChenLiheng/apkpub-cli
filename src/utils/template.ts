import { ApkpubError, ErrorCode } from '../errors/ApkpubError.js';

export interface TemplateContext {
  appId: string;
  versionName: string;
  versionCode: number;
  fileName: string;
  objectKey?: string;
}

const PLACEHOLDER_RE = /\{(\w+)\}/g;

/** 渲染模板占位符 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  const map: Record<string, string | number> = {
    appId: ctx.appId,
    versionName: ctx.versionName,
    versionCode: ctx.versionCode,
    fileName: ctx.fileName,
    objectKey: ctx.objectKey ?? '',
  };
  const rendered = template.replace(PLACEHOLDER_RE, (_, key: string) => {
    const value = map[key];
    if (value === undefined) return `{${key}}`;
    return String(value);
  });
  return sanitizePath(rendered);
}

/** 防止路径穿越 */
export function sanitizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.includes('..') || normalized.startsWith('/')) {
    throw new ApkpubError({
      code: ErrorCode.INVALID_ARGUMENT,
      message: `路径模板包含非法字符: ${path}`,
      retryable: false,
    });
  }
  return normalized.replace(/^\/+/, '');
}
