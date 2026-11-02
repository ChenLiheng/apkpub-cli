import { Command } from 'commander';
import {
  PACKAGE_NAME,
  buildInstallCommand,
  compareVersions,
  detectPackageManager,
  fetchLatestVersion,
  getInstallPath,
  runInstall,
  syncBundledSkill,
  syncSkillWithInstalledBinary,
} from '../core/updater.js';
import { ExitCode } from '../core/result.js';
import { printJson } from '../utils/output.js';
import { setJsonMode } from '../utils/logger.js';
import { PACKAGE_VERSION } from '../version.js';

interface UpdateOptions {
  check?: boolean;
  skillOnly?: boolean;
  force?: boolean;
  tag: string;
  json?: boolean;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('升级 apkpub 自身，并同步内置 Agent skill')
    .option('--check', '仅检查是否有新版本，不安装')
    .option('--skill-only', '仅同步当前版本内置的 skill，不升级 CLI')
    .option('--force', '即使已是最新版本也重新安装')
    .option('--tag <tag>', '目标 npm dist-tag（如 latest / beta）', 'latest')
    .option('--json', 'JSON 格式输出')
    .action(async (options: UpdateOptions) => {
      setJsonMode(!!options.json);
      const log = (msg: string): void => {
        if (!options.json) process.stderr.write(`${msg}\n`);
      };
      const fail = (message: string): never => {
        if (options.json) printJson({ ok: false, error: { message } });
        else process.stderr.write(`错误: ${message}\n`);
        process.exit(ExitCode.INTERNAL);
      };

      try {
        if (options.skillOnly) {
          const skillPaths = syncBundledSkill();
          if (options.json) printJson({ ok: true, version: PACKAGE_VERSION, skillPaths });
          else log(skillPaths.length ? `已同步 skill:\n${skillPaths.map((p) => `  - ${p}`).join('\n')}` : '未检测到需要同步的 Agent 目录');
          return;
        }

        const latest = fetchLatestVersion(options.tag);
        const hasUpdate = compareVersions(latest, PACKAGE_VERSION) > 0;
        const base = { current: PACKAGE_VERSION, latest, hasUpdate };

        if (options.check) {
          if (options.json) printJson({ ok: true, ...base });
          else log(hasUpdate ? `发现新版本 ${latest}（当前 ${PACKAGE_VERSION}），运行 apkpub update 升级` : `已是最新版本 ${PACKAGE_VERSION}`);
          return;
        }

        if (!hasUpdate && !options.force) {
          // 版本已最新时仍同步 skill，修复被跳过 postinstall 的情况
          const skillPaths = syncBundledSkill();
          if (options.json) printJson({ ok: true, ...base, updated: false, skillPaths });
          else log(`已是最新版本 ${PACKAGE_VERSION}，已重新同步 skill`);
          return;
        }

        const pm = detectPackageManager(getInstallPath());
        const cmd = buildInstallCommand(pm, latest);
        log(`使用 ${pm} 升级 ${PACKAGE_NAME}: ${PACKAGE_VERSION} → ${latest}`);
        await runInstall(cmd);

        // pnpm 等可能不执行 postinstall，这里显式同步新版本自带的 skill
        let skillPaths: string[] = [];
        let skillError: string | undefined;
        try {
          skillPaths = syncSkillWithInstalledBinary();
        } catch (err) {
          skillError = err instanceof Error ? err.message : String(err);
        }

        if (options.json) {
          printJson({ ok: true, ...base, updated: true, packageManager: pm, skillPaths, ...(skillError ? { skillError } : {}) });
        } else {
          log(`升级完成: ${latest}`);
          if (skillError) log(`警告: skill 同步失败，可手动运行 apkpub update --skill-only（${skillError}）`);
          else log(skillPaths.length ? `已同步 skill:\n${skillPaths.map((p) => `  - ${p}`).join('\n')}` : '未检测到需要同步的 Agent 目录');
        }
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    });
}
