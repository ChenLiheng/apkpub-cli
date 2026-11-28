import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from './store.js';
import { ErrorCode } from '../errors/ApkpubError.js';

describe('loadConfig', () => {
  const originalHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'apkpub-home-'));
    process.env.HOME = home;
    mkdirSync(path.join(home, '.apkpub', 'apps'), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('配置文件 JSON 损坏时抛 CONFIG_INVALID', async () => {
    writeFileSync(path.join(home, '.apkpub', 'apps', 'com.example.app.json'), '{ not json');
    await expect(loadConfig('com.example.app')).rejects.toMatchObject({ code: ErrorCode.CONFIG_INVALID });
  });

  it('配置文件不存在时抛 CONFIG_NOT_FOUND', async () => {
    await expect(loadConfig('com.missing.app')).rejects.toMatchObject({ code: ErrorCode.CONFIG_NOT_FOUND });
  });
});
