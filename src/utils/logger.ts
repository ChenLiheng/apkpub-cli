import pc from 'picocolors';
import { redactMessage } from './redaction.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let jsonMode = false;
let debugMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

function formatMessage(level: LogLevel, tag: string, message: string): string {
  const time = new Date().toISOString();
  const levelColors: Record<LogLevel, (s: string) => string> = {
    debug: pc.gray,
    info: pc.blue,
    warn: pc.yellow,
    error: pc.red,
  };
  return `${pc.dim(time)} ${levelColors[level](level.toUpperCase())} [${tag}] ${redactMessage(message)}`;
}

function log(level: LogLevel, tag: string, message: string): void {
  if (level === 'debug' && !debugMode) return;
  // JSON 模式下屏蔽 info/warn；显式开启 --debug 时仍输出调试日志（走 stderr，不影响 JSON 解析）
  if (jsonMode && level !== 'error' && level !== 'debug') return;
  process.stderr.write(formatMessage(level, tag, message) + '\n');
}

export const logger = {
  debug: (tag: string, message: string) => log('debug', tag, message),
  info: (tag: string, message: string) => log('info', tag, message),
  warn: (tag: string, message: string) => log('warn', tag, message),
  error: (tag: string, message: string) => log('error', tag, message),
};
