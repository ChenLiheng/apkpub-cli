import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MANIFEST_FILE,
  SKILL_NAME,
  getSkillStatus,
  installSkill,
  isSafeManifestPath,
  isSkillAutoSyncDisabled,
  needsSkillSync,
  setSkillAutoSync,
  resolveSkillSource,
  uninstallSkill,
  type SkillTarget,
} from './installer.js';

let root: string;
let source: string;
let agentDir: string;
let target: SkillTarget;
let dest: string;

function writeSource(files: Record<string, string>): void {
  rmSync(source, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(source, rel)), { recursive: true });
    writeFileSync(path.join(source, rel), content);
  }
}

const read = (rel: string) => readFileSync(path.join(dest, rel), 'utf8');

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'apkpub-skill-'));
  source = path.join(root, 'source');
  agentDir = path.join(root, '.claude');
  mkdirSync(agentDir);
  target = { label: 'claude', agentDir, skillsDir: path.join(agentDir, 'skills') };
  dest = path.join(target.skillsDir, SKILL_NAME);
  writeSource({ 'SKILL.md': 'v1', 'references/a.md': 'a1' });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('installSkill', () => {
  it('首次安装复制全部文件并写入清单', async () => {
    const [result] = await installSkill({ version: '1.0.0', targets: [target], sourceDir: source });
    expect(result.action).toBe('installed');
    expect(read('SKILL.md')).toBe('v1');
    expect(read('references/a.md')).toBe('a1');
    const manifest = JSON.parse(read(MANIFEST_FILE));
    expect(manifest.version).toBe('1.0.0');
    expect(Object.keys(manifest.files).sort()).toEqual(['SKILL.md', 'references/a.md']);
  });

  it('未检测到 Agent 配置目录时跳过，--all 时强制安装', async () => {
    const missing = { label: 'cursor', agentDir: path.join(root, '.cursor'), skillsDir: path.join(root, '.cursor', 'skills') };
    const [skipped] = await installSkill({ version: '1.0.0', targets: [missing], sourceDir: source });
    expect(skipped.action).toBe('skipped');
    expect(existsSync(missing.skillsDir)).toBe(false);
    const [forced] = await installSkill({ version: '1.0.0', targets: [missing], sourceDir: source, all: true });
    expect(forced.action).toBe('installed');
  });

  it('升级时覆盖未修改的文件，删除新版不再包含的文件，保留用户自己添加的文件', async () => {
    await installSkill({ version: '1.0.0', targets: [target], sourceDir: source });
    writeFileSync(path.join(dest, 'my-notes.md'), '用户笔记');
    writeSource({ 'SKILL.md': 'v2' });
    const [result] = await installSkill({ version: '1.1.0', targets: [target], sourceDir: source });
    expect(result.action).toBe('updated');
    expect(read('SKILL.md')).toBe('v2');
    expect(result.removed).toEqual(['references/a.md']);
    expect(existsSync(path.join(dest, 'references'))).toBe(false);
    expect(read('my-notes.md')).toBe('用户笔记');
  });

  it('用户修改过的文件不覆盖并报告冲突；--force 时备份后覆盖', async () => {
    await installSkill({ version: '1.0.0', targets: [target], sourceDir: source });
    writeFileSync(path.join(dest, 'SKILL.md'), '用户改过');
    writeSource({ 'SKILL.md': 'v2', 'references/a.md': 'a1' });

    const [kept] = await installSkill({ version: '1.1.0', targets: [target], sourceDir: source });
    expect(kept.conflicts).toEqual(['SKILL.md']);
    expect(kept.action).toBe('unchanged');
    expect(read('SKILL.md')).toBe('用户改过');

    const [forced] = await installSkill({ version: '1.1.0', targets: [target], sourceDir: source, force: true });
    expect(read('SKILL.md')).toBe('v2');
    expect(forced.backups).toHaveLength(1);
    expect(readFileSync(forced.backups[0], 'utf8')).toBe('用户改过');
  });

  it('旧版安装（无清单）：备份后覆盖，不动其他文件', async () => {
    mkdirSync(path.join(dest, 'scripts'), { recursive: true });
    writeFileSync(path.join(dest, 'SKILL.md'), '旧版内容');
    writeFileSync(path.join(dest, 'scripts', 'custom.py'), 'print(1)');
    const [result] = await installSkill({ version: '1.0.0', targets: [target], sourceDir: source });
    expect(result.action).toBe('updated');
    expect(read('SKILL.md')).toBe('v1');
    expect(readFileSync(`${path.join(dest, 'SKILL.md')}.bak`, 'utf8')).toBe('旧版内容');
    expect(read('scripts/custom.py')).toBe('print(1)');
  });

  it('版本与内容都未变化时为 unchanged', async () => {
    await installSkill({ version: '1.0.0', targets: [target], sourceDir: source });
    const [result] = await installSkill({ version: '1.0.0', targets: [target], sourceDir: source });
    expect(result.action).toBe('unchanged');
  });
});

describe('needsSkillSync', () => {
  it('未安装或版本不一致时需要同步，一致时不需要', async () => {
    expect(await needsSkillSync('1.0.0', [target])).toBe(true);
    await installSkill({ version: '1.0.0', targets: [target], sourceDir: source });
    expect(await needsSkillSync('1.0.0', [target])).toBe(false);
    expect(await needsSkillSync('1.1.0', [target])).toBe(true);
  });

  it('未检测到 Agent 时不需要同步', async () => {
    rmSync(agentDir, { recursive: true });
    expect(await needsSkillSync('1.0.0', [target])).toBe(false);
  });
});

describe('getSkillStatus / uninstallSkill', () => {
  it('报告版本与被修改的文件；卸载时保留修改过的文件与用户文件', async () => {
    await installSkill({ version: '1.0.0', targets: [target], sourceDir: source });
    writeFileSync(path.join(dest, 'references/a.md'), '改过');
    writeFileSync(path.join(dest, 'mine.md'), '我的');

    const [status] = await getSkillStatus([target]);
    expect(status).toMatchObject({ installed: true, managed: true, version: '1.0.0', modified: ['references/a.md'] });

    const [result] = await uninstallSkill({ targets: [target] });
    expect(result.removed).toEqual(['SKILL.md']);
    expect(result.kept).toEqual(['references/a.md']);
    expect(existsSync(path.join(dest, MANIFEST_FILE))).toBe(false);
    expect(read('mine.md')).toBe('我的');
  });

  it('全部为托管文件时卸载后删除目录', async () => {
    await installSkill({ version: '1.0.0', targets: [target], sourceDir: source });
    await uninstallSkill({ targets: [target] });
    expect(existsSync(dest)).toBe(false);
  });
});

describe('resolveSkillSource', () => {
  it('源码运行时能找到仓库内的 skill 目录', () => {
    const dir = resolveSkillSource();
    expect(dir && existsSync(path.join(dir, 'SKILL.md'))).toBe(true);
  });
});

describe('清单路径安全', () => {
  it('拒绝绝对路径、.. 与清单文件自身', () => {
    expect(isSafeManifestPath('/a/skill', 'SKILL.md')).toBe(true);
    expect(isSafeManifestPath('/a/skill', 'references/x.md')).toBe(true);
    expect(isSafeManifestPath('/a/skill', '../outside.md')).toBe(false);
    expect(isSafeManifestPath('/a/skill', 'references/../../outside.md')).toBe(false);
    expect(isSafeManifestPath('/a/skill', '/etc/passwd')).toBe(false);
    expect(isSafeManifestPath('/a/skill', MANIFEST_FILE)).toBe(false);
  });

  it('清单被篡改指向目录外时，--force 卸载与升级都不会删除目录外文件', async () => {
    await installSkill({ version: '1.0.0', targets: [target], sourceDir: source });
    const outside = path.join(root, 'outside.md');
    writeFileSync(outside, '目录外的文件');
    const manifestPath = path.join(dest, MANIFEST_FILE);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.files['../../../outside.md'] = 'deadbeef';
    writeFileSync(manifestPath, JSON.stringify(manifest));

    await installSkill({ version: '1.1.0', targets: [target], sourceDir: source, force: true });
    expect(existsSync(outside)).toBe(true);

    writeFileSync(manifestPath, JSON.stringify(manifest));
    await uninstallSkill({ targets: [target], force: true });
    expect(existsSync(outside)).toBe(true);
  });

  it('目标文件是符号链接时不覆盖链接指向的文件', async () => {
    await installSkill({ version: '1.0.0', targets: [target], sourceDir: source });
    const linked = path.join(root, 'my-skill.md');
    writeFileSync(linked, '我的版本');
    rmSync(path.join(dest, 'SKILL.md'));
    symlinkSync(linked, path.join(dest, 'SKILL.md'));
    writeSource({ 'SKILL.md': 'v2', 'references/a.md': 'a1' });
    const [result] = await installSkill({ version: '1.1.0', targets: [target], sourceDir: source, force: true });
    expect(result.conflicts).toContain('SKILL.md');
    expect(readFileSync(linked, 'utf8')).toBe('我的版本');
  });
});

describe('自动同步开关', () => {
  it('默认开启；关闭后记录在状态文件，重新开启时删除', async () => {
    const statePath = path.join(root, '.apkpub', 'skill-state.json');
    expect(await isSkillAutoSyncDisabled(statePath)).toBe(false);
    await setSkillAutoSync(false, statePath);
    expect(await isSkillAutoSyncDisabled(statePath)).toBe(true);
    await setSkillAutoSync(true, statePath);
    expect(await isSkillAutoSyncDisabled(statePath)).toBe(false);
    expect(existsSync(statePath)).toBe(false);
  });
});
