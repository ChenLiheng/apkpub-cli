import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 随包发布的 skill 名称 */
export const SKILL_NAME = 'using-apkpub-cli';

/** 安装清单文件名：记录安装版本与各文件哈希，用于判断用户修改与清理旧文件 */
export const MANIFEST_FILE = '.apkpub-skill.json';

/** 自动同步状态文件：用户执行 skill uninstall 后记录退出，自动同步与 postinstall 不再重新安装 */
export function getSkillStatePath(): string {
  return path.join(os.homedir(), '.apkpub', 'skill-state.json');
}

/** 自动同步是否已被用户关闭（执行过 skill uninstall 且之后没有手动 install） */
export async function isSkillAutoSyncDisabled(statePath = getSkillStatePath()): Promise<boolean> {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8')) as { autoSync?: unknown };
    return state.autoSync === false;
  } catch {
    return false;
  }
}

/** 设置自动同步开关：uninstall 时关闭，手动 install 时重新开启 */
export async function setSkillAutoSync(enabled: boolean, statePath = getSkillStatePath()): Promise<void> {
  if (enabled) {
    await rm(statePath, { force: true });
    return;
  }
  await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  await writeFile(statePath, `${JSON.stringify({ autoSync: false, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

/** 安装目标：一个 Agent 的 skills 目录 */
export interface SkillTarget {
  label: string;
  /** Agent 配置根目录，存在才说明用户在用该 Agent */
  agentDir: string;
  /** skills 根目录，skill 安装到 <skillsDir>/<SKILL_NAME> */
  skillsDir: string;
  /** 不检测 agentDir，总是安装（APKPUB_SKILL_DIRS 指定的目录） */
  alwaysInstall?: boolean;
}

interface SkillManifest {
  name: string;
  version: string;
  /** 相对路径 → sha256 */
  files: Record<string, string>;
}

export type TargetAction = 'installed' | 'updated' | 'unchanged' | 'skipped';

/** 单个目标的安装结果 */
export interface TargetInstallResult {
  label: string;
  dir: string;
  action: TargetAction;
  /** 用户修改过、未被覆盖的文件 */
  conflicts: string[];
  /** 覆盖前备份的文件（--force 或旧版无清单时） */
  backups: string[];
  /** 新版本不再包含、已删除的文件 */
  removed: string[];
  error?: string;
}

export interface InstallOptions {
  version: string;
  /** 覆盖用户修改过的文件（覆盖前备份） */
  force?: boolean;
  /** 为所有目标安装，即使 Agent 配置目录不存在 */
  all?: boolean;
  targets?: SkillTarget[];
  sourceDir?: string;
}

/** 单个目标的状态 */
export interface TargetStatus {
  label: string;
  dir: string;
  /** Agent 是否存在（配置目录存在） */
  detected: boolean;
  installed: boolean;
  /** 已安装版本；旧版安装（无清单）为 undefined */
  version?: string;
  managed: boolean;
  modified: string[];
}

/** 定位随包发布的 skill 目录：打包后位于 dist/ 同级，源码运行时位于仓库根目录 */
export function resolveSkillSource(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, '..', 'skills', SKILL_NAME),
    path.join(here, '..', '..', 'skills', SKILL_NAME),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, 'SKILL.md')));
}

/** 默认安装目标；APKPUB_SKILL_DIRS（逗号分隔）可追加自定义 skills 根目录 */
export function getDefaultTargets(): SkillTarget[] {
  const home = os.homedir();
  const targets: SkillTarget[] = [
    { label: 'agents', agentDir: path.join(home, '.agents'), skillsDir: path.join(home, '.agents', 'skills') },
    { label: 'cursor', agentDir: path.join(home, '.cursor'), skillsDir: path.join(home, '.cursor', 'skills') },
    { label: 'hermes', agentDir: path.join(home, '.hermes'), skillsDir: path.join(home, '.hermes', 'skills') },
    { label: 'claude', agentDir: path.join(home, '.claude'), skillsDir: path.join(home, '.claude', 'skills') },
  ];
  const extra = (process.env.APKPUB_SKILL_DIRS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const dir of extra) {
    targets.push({ label: 'custom', agentDir: dir, skillsDir: dir, alwaysInstall: true });
  }
  return targets;
}

function shouldInstall(target: SkillTarget, all?: boolean): boolean {
  return Boolean(all || target.alwaysInstall || existsSync(target.agentDir));
}

function skillDir(target: SkillTarget): string {
  return path.join(target.skillsDir, SKILL_NAME);
}

async function hashFile(filePath: string): Promise<string | undefined> {
  try {
    return createHash('sha256').update(await readFile(filePath)).digest('hex');
  } catch {
    return undefined;
  }
}

/** 递归列出目录下的文件（相对路径，统一用 / 分隔） */
async function listFiles(root: string, rel = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, rel), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, relPath)));
    else if (entry.isFile()) files.push(relPath);
  }
  return files.sort();
}

/** 清单中的路径必须是 skill 目录内的相对路径：拒绝绝对路径、.. 与清单文件自身，防止清单损坏时删到目录外 */
export function isSafeManifestPath(dir: string, relPath: string): boolean {
  if (typeof relPath !== 'string' || relPath === '' || relPath === MANIFEST_FILE) return false;
  if (path.isAbsolute(relPath) || relPath.split(/[\\/]/).includes('..')) return false;
  const resolved = path.resolve(dir, relPath);
  return resolved.startsWith(path.resolve(dir) + path.sep);
}

async function readManifest(dir: string): Promise<SkillManifest | undefined> {
  try {
    const data = JSON.parse(await readFile(path.join(dir, MANIFEST_FILE), 'utf8')) as SkillManifest;
    if (!data || typeof data.version !== 'string' || !data.files || typeof data.files !== 'object') return undefined;
    // 丢弃不安全或格式错误的条目，后续只处理目录内的文件
    const files: Record<string, string> = {};
    for (const [relPath, hash] of Object.entries(data.files)) {
      if (typeof hash === 'string' && isSafeManifestPath(dir, relPath)) files[relPath] = hash;
    }
    return { ...data, files };
  } catch {
    // 无清单或清单损坏：视为旧版安装
  }
  return undefined;
}

/** 路径是否为符号链接：用户自行链接的文件不覆盖、不删除，避免写穿到链接指向的位置 */
async function isSymlink(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isSymbolicLink();
  } catch {
    return false;
  }
}

/** 覆盖前备份：<file>.bak，已存在时追加时间戳 */
async function backupFile(filePath: string): Promise<string> {
  let backup = `${filePath}.bak`;
  if (existsSync(backup)) backup = `${filePath}.${Date.now()}.bak`;
  await copyFile(filePath, backup);
  return backup;
}

/** 删除文件后，自下而上清理变空的父目录（不越过 skill 根目录） */
async function removeFileAndEmptyParents(root: string, relPath: string): Promise<void> {
  await rm(path.join(root, relPath), { force: true });
  let dir = path.dirname(path.join(root, relPath));
  while (dir.startsWith(root) && dir !== root) {
    try {
      await rmdir(dir);
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }
}

async function installToTarget(
  target: SkillTarget,
  source: string,
  sourceHashes: Record<string, string>,
  options: InstallOptions,
): Promise<TargetInstallResult> {
  const dir = skillDir(target);
  const result: TargetInstallResult = {
    label: target.label,
    dir,
    action: 'skipped',
    conflicts: [],
    backups: [],
    removed: [],
  };
  if (!shouldInstall(target, options.all)) return result;

  const existed = existsSync(dir);
  const manifest = existed ? await readManifest(dir) : undefined;
  let changed = false;

  await mkdir(dir, { recursive: true });
  for (const [relPath, sourceHash] of Object.entries(sourceHashes)) {
    const dest = path.join(dir, relPath);
    if (await isSymlink(dest)) {
      result.conflicts.push(relPath);
      continue;
    }
    const destHash = await hashFile(dest);
    if (destHash === sourceHash) continue;

    if (destHash !== undefined) {
      const managedHash = manifest?.files[relPath];
      // 文件与上次安装时一致，说明用户没改过，可直接覆盖
      const untouched = managedHash !== undefined && managedHash === destHash;
      if (!untouched) {
        if (manifest && !options.force) {
          result.conflicts.push(relPath);
          continue;
        }
        // 旧版安装（无清单）无法判断是否修改过，或显式 --force：先备份再覆盖
        result.backups.push(await backupFile(dest));
      }
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(path.join(source, relPath), dest);
    changed = true;
  }

  // 清理新版本不再包含的文件：只删除清单里登记过且未被用户修改的文件，用户自己添加的文件一律不动
  if (manifest) {
    for (const [relPath, managedHash] of Object.entries(manifest.files)) {
      if (relPath in sourceHashes) continue;
      if (await isSymlink(path.join(dir, relPath))) continue;
      const destHash = await hashFile(path.join(dir, relPath));
      if (destHash === undefined) continue;
      if (destHash === managedHash || options.force) {
        await removeFileAndEmptyParents(dir, relPath);
        result.removed.push(relPath);
        changed = true;
      } else {
        result.conflicts.push(relPath);
      }
    }
  }

  const versionChanged = manifest?.version !== options.version;
  const nextManifest: SkillManifest = { name: SKILL_NAME, version: options.version, files: sourceHashes };
  if (changed || versionChanged || !manifest) {
    await writeFile(path.join(dir, MANIFEST_FILE), `${JSON.stringify(nextManifest, null, 2)}\n`);
  }

  // 只有实际写入或删除了文件才算更新；仅因冲突跳过时由 conflicts 单独提示
  result.action = !existed ? 'installed' : changed ? 'updated' : 'unchanged';
  return result;
}

async function computeSourceHashes(source: string): Promise<Record<string, string>> {
  const files = await listFiles(source);
  const hashes: Record<string, string> = {};
  for (const relPath of files) {
    if (relPath === MANIFEST_FILE) continue;
    const hash = await hashFile(path.join(source, relPath));
    if (hash) hashes[relPath] = hash;
  }
  return hashes;
}

/** 安装或更新 skill 到所有已检测到的 Agent；单个目标失败不影响其他目标 */
export async function installSkill(options: InstallOptions): Promise<TargetInstallResult[]> {
  const source = options.sourceDir ?? resolveSkillSource();
  if (!source) throw new Error(`未找到随包发布的 skill 目录（skills/${SKILL_NAME}）`);
  const sourceHashes = await computeSourceHashes(source);
  const results: TargetInstallResult[] = [];
  for (const target of options.targets ?? getDefaultTargets()) {
    try {
      results.push(await installToTarget(target, source, sourceHashes, options));
    } catch (err) {
      results.push({
        label: target.label,
        dir: skillDir(target),
        action: 'skipped',
        conflicts: [],
        backups: [],
        removed: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/** 是否有已检测到的 Agent 需要同步（未安装或版本不一致）；只读少量小文件，供每次启动时快速判断 */
export async function needsSkillSync(version: string, targets = getDefaultTargets()): Promise<boolean> {
  for (const target of targets) {
    if (!shouldInstall(target)) continue;
    const manifest = await readManifest(skillDir(target));
    if (manifest?.version !== version) return true;
  }
  return false;
}

/** 查询各目标的安装状态 */
export async function getSkillStatus(targets = getDefaultTargets()): Promise<TargetStatus[]> {
  const statuses: TargetStatus[] = [];
  for (const target of targets) {
    const dir = skillDir(target);
    const installed = existsSync(path.join(dir, 'SKILL.md'));
    const manifest = installed ? await readManifest(dir) : undefined;
    const modified: string[] = [];
    if (manifest) {
      for (const [relPath, hash] of Object.entries(manifest.files)) {
        const destHash = await hashFile(path.join(dir, relPath));
        if (destHash !== undefined && destHash !== hash) modified.push(relPath);
      }
    }
    statuses.push({
      label: target.label,
      dir,
      detected: shouldInstall(target),
      installed,
      version: manifest?.version,
      managed: Boolean(manifest),
      modified,
    });
  }
  return statuses;
}

/** 单个目标的卸载结果 */
export interface TargetUninstallResult {
  label: string;
  dir: string;
  removed: string[];
  /** 用户修改过而保留的文件 */
  kept: string[];
  /** 无清单的旧版安装，未做任何处理 */
  unmanaged?: boolean;
}

/** 卸载 skill：只删除清单登记且未被修改的文件（--force 时也删除修改过的），用户自己添加的文件保留 */
export async function uninstallSkill(
  options: { force?: boolean; targets?: SkillTarget[] } = {},
): Promise<TargetUninstallResult[]> {
  const results: TargetUninstallResult[] = [];
  for (const target of options.targets ?? getDefaultTargets()) {
    const dir = skillDir(target);
    if (!existsSync(dir)) continue;
    const manifest = await readManifest(dir);
    if (!manifest) {
      results.push({ label: target.label, dir, removed: [], kept: [], unmanaged: true });
      continue;
    }
    const result: TargetUninstallResult = { label: target.label, dir, removed: [], kept: [] };
    for (const [relPath, hash] of Object.entries(manifest.files)) {
      if (await isSymlink(path.join(dir, relPath))) {
        result.kept.push(relPath);
        continue;
      }
      const destHash = await hashFile(path.join(dir, relPath));
      if (destHash === undefined) continue;
      if (destHash === hash || options.force) {
        await removeFileAndEmptyParents(dir, relPath);
        result.removed.push(relPath);
      } else {
        result.kept.push(relPath);
      }
    }
    await rm(path.join(dir, MANIFEST_FILE), { force: true });
    // 目录已空则一并删除
    try {
      if ((await stat(dir)).isDirectory() && (await readdir(dir)).length === 0) await rmdir(dir);
    } catch {
      // 忽略
    }
    results.push(result);
  }
  return results;
}
