import { spawn, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PACKAGE_NAME = 'apkpub-cli';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface InstallCommand {
  command: string;
  args: string[];
}

/** 将版本号拆成数字核心与预发布标识 */
function parseVersion(version: string): { core: number[]; pre: string[] } {
  const [main = '', pre = ''] = version.trim().replace(/^v/, '').split('+')[0]!.split(/-(.*)/s);
  const core = main.split('.').map((n) => Number.parseInt(n, 10) || 0);
  return { core, pre: pre ? pre.split('.') : [] };
}

/** 语义化版本比较：a > b 返回正数，相等返回 0，a < b 返回负数 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.core.length, pb.core.length, 3); i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // 正式版高于同核心版本的预发布版
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : undefined;
    const ny = /^\d+$/.test(y) ? Number(y) : undefined;
    if (nx !== undefined && ny !== undefined) {
      if (nx !== ny) return nx - ny;
    } else if (nx !== undefined) {
      return -1;
    } else if (ny !== undefined) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** 根据当前可执行文件的安装路径推断全局安装所用的包管理器 */
export function detectPackageManager(installPath: string): PackageManager {
  const p = installPath.replace(/\\/g, '/').toLowerCase();
  if (p.includes('/pnpm/') || p.includes('/.pnpm/')) return 'pnpm';
  if (p.includes('/.bun/')) return 'bun';
  if (p.includes('/yarn/') || p.includes('/.yarn/')) return 'yarn';
  return 'npm';
}

/** 构造全局安装指定版本的命令 */
export function buildInstallCommand(pm: PackageManager, version: string): InstallCommand {
  const spec = `${PACKAGE_NAME}@${version}`;
  switch (pm) {
    case 'npm':
      return { command: 'npm', args: ['install', '-g', spec] };
    case 'pnpm':
      return { command: 'pnpm', args: ['add', '-g', spec] };
    case 'yarn':
      return { command: 'yarn', args: ['global', 'add', spec] };
    case 'bun':
      return { command: 'bun', args: ['add', '-g', spec] };
    default: {
      const never: never = pm;
      throw new Error(`不支持的包管理器: ${String(never)}`);
    }
  }
}

/** 获取当前运行的 apkpub 真实安装路径 */
export function getInstallPath(): string {
  try {
    return realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return fileURLToPath(import.meta.url);
  }
}

const isWindows = process.platform === 'win32';

/** 通过 npm registry（遵循用户 registry/镜像配置）查询指定 dist-tag 的最新版本 */
export function fetchLatestVersion(tag: string): string {
  const res = spawnSync('npm', ['view', `${PACKAGE_NAME}@${tag}`, 'version'], {
    encoding: 'utf8',
    shell: isWindows,
  });
  const version = res.stdout?.trim().split('\n').pop()?.trim();
  if (res.status !== 0 || !version) {
    throw new Error(`查询最新版本失败: ${res.stderr?.trim() || res.error?.message || '无输出'}`);
  }
  return version;
}

/** 执行安装命令，输出转发到 stderr，保证 --json 的 stdout 干净 */
export function runInstall(cmd: InstallCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.command, cmd.args, { stdio: ['ignore', 2, 2], shell: isWindows });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd.command} ${cmd.args.join(' ')} 退出码 ${code}`));
    });
  });
}

/**
 * 同步随包 skill 到各 Agent 目录，返回已写入的路径。
 * 复用 postinstall 使用的 scripts/install-skill.mjs，保证两条路径行为一致。
 */
export function syncBundledSkill(): string[] {
  const script = fileURLToPath(new URL('../scripts/install-skill.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`skill 同步失败: ${res.stderr?.trim() || res.error?.message || res.status}`);
  }
  return (res.stderr ?? '')
    .split('\n')
    .filter((line) => line.startsWith('  - '))
    .map((line) => line.slice(4).trim());
}

/** 调用升级后新安装的 apkpub，仅同步 skill（当前进程仍是旧代码与旧 skill） */
export function syncSkillWithInstalledBinary(): string[] {
  const res = spawnSync('apkpub', ['update', '--skill-only', '--json'], {
    encoding: 'utf8',
    shell: isWindows,
  });
  if (res.status !== 0) {
    throw new Error(res.stderr?.trim() || res.error?.message || `退出码 ${res.status}`);
  }
  const parsed = JSON.parse(res.stdout) as { skillPaths?: string[] };
  return parsed.skillPaths ?? [];
}
