import { describe, expect, it } from 'vitest';
import { buildInstallCommand, compareVersions, detectPackageManager } from './updater.js';

describe('compareVersions', () => {
  it('比较数字核心', () => {
    expect(compareVersions('0.0.7', '0.0.6')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('0.0.6', '0.1.0')).toBeLessThan(0);
  });

  it('预发布版本低于正式版', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('1.0.0-rc.1', '1.0.0-beta.9')).toBeGreaterThan(0);
  });
});

describe('detectPackageManager', () => {
  it('按安装路径识别', () => {
    expect(detectPackageManager('/home/u/.local/share/pnpm/global/5/node_modules/apkpub-cli/dist/apkpub.js')).toBe('pnpm');
    expect(detectPackageManager('/home/u/.bun/install/global/node_modules/apkpub-cli/dist/apkpub.js')).toBe('bun');
    expect(detectPackageManager('/usr/lib/node_modules/apkpub-cli/dist/apkpub.js')).toBe('npm');
  });
});

describe('buildInstallCommand', () => {
  it('生成全局安装命令', () => {
    expect(buildInstallCommand('npm', '1.2.3')).toEqual({ command: 'npm', args: ['install', '-g', 'apkpub-cli@1.2.3'] });
    expect(buildInstallCommand('pnpm', '1.2.3').args).toEqual(['add', '-g', 'apkpub-cli@1.2.3']);
  });
});
