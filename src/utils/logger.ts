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
  if (jsonMode && level !== 'error') return;
  if (level === 'debug' && !debugMode) return;
  const stream = level === 'error' ? process.stderr : process.stderr;
  stream.write(formatMessage(level, tag, message) + '\n');
}

export const logger = {
  debug: (tag: string, message: string) => log('debug', tag, message),
  info: (tag: string, message: string) => log('info', tag, message),
  warn: (tag: string, message: string) => log('warn', tag, message),
  error: (tag: string, message: string) => log('error', tag, message),
};
