import { Command, Option } from 'commander';
import pc from 'picocolors';
import {
  SKILL_NAME,
  getSkillStatus,
  installSkill,
  isSkillAutoSyncDisabled,
  needsSkillSync,
  setSkillAutoSync,
  uninstallSkill,
  type TargetInstallResult,
} from '../skill/installer.js';
import { printJson, exitAfterFlush } from '../utils/output.js';
import { ExitCode } from '../core/result.js';
import { PACKAGE_VERSION } from '../version.js';

/** 判断环境变量是否为真值 */
function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === '1' || v === 'true' || v === 'yes';
}

/** 把安装结果写成人类可读的 stderr 文本 */
function reportInstall(results: TargetInstallResult[], quiet: boolean): void {
  const touched = results.filter((r) => r.action === 'installed' || r.action === 'updated');
  if (touched.length > 0) {
    process.stderr.write(`[apkpub] 已同步 skill "${SKILL_NAME}" (v${PACKAGE_VERSION}) 到:\n`);
    for (const r of touched) process.stderr.write(`  - ${r.dir}\n`);
  } else if (!quiet) {
    process.stderr.write(`[apkpub] skill "${SKILL_NAME}" 已是最新 (v${PACKAGE_VERSION})\n`);
  }
  for (const r of results) {
    for (const file of r.conflicts) {
      process.stderr.write(
        pc.yellow(`[apkpub] ${r.dir}/${file} 已被修改，未覆盖；运行 apkpub skill install --force 覆盖（会先备份）\n`),
      );
    }
    for (const backup of r.backups) process.stderr.write(pc.dim(`[apkpub] 已备份原文件: ${backup}\n`));
    if (r.error) process.stderr.write(pc.yellow(`[apkpub] 同步到 ${r.dir} 失败: ${r.error}\n`));
  }
  if (!quiet && results.every((r) => r.action === 'skipped' && !r.error)) {
    process.stderr.write('[apkpub] 未检测到 Agent 配置目录；可用 --all 强制安装，或设置 APKPUB_SKILL_DIRS 指定目录\n');
  }
}

/**
 * 启动时自动同步 skill：已检测到的 Agent 未安装或版本与 CLI 不一致时才写入。
 * 覆盖 pnpm / bun 默认跳过 postinstall、以及先装 apkpub 后装 Agent 的情况。任何失败都静默忽略。
 */
export async function autoSyncSkill(): Promise<void> {
  if (envFlag('APKPUB_SKIP_SKILL_INSTALL') || envFlag('CI')) return;
  try {
    // 用户执行过 skill uninstall：不再自动装回
    if (await isSkillAutoSyncDisabled()) return;
    if (!(await needsSkillSync(PACKAGE_VERSION))) return;
    const results = await installSkill({ version: PACKAGE_VERSION });
    reportInstall(results, true);
  } catch {
    // 自动同步不能影响命令本身
  }
}

export function registerSkillCommand(program: Command): void {
  const skill = program.command('skill').description(`管理随包发布的 Agent skill（${SKILL_NAME}）`);

  skill
    .command('install')
    .description('安装或更新 skill 到已检测到的 Agent skills 目录')
    .option('--force', '覆盖被修改过的文件（覆盖前备份为 .bak）')
    .option('--all', '为所有支持的 Agent 安装，即使未检测到其配置目录')
    .option('--quiet', '已是最新时不输出')
    .option('--json', 'JSON 格式输出')
    .addOption(new Option('--auto', '自动同步模式（postinstall 使用）：用户卸载过时不安装').hideHelp())
    .action(async (options: { force?: boolean; all?: boolean; quiet?: boolean; json?: boolean; auto?: boolean }) => {
      if (envFlag('APKPUB_SKIP_SKILL_INSTALL') || (options.auto && (await isSkillAutoSyncDisabled()))) {
        if (options.json) printJson({ ok: true, skipped: true, results: [] });
        await exitAfterFlush(ExitCode.SUCCESS);
      }
      try {
        // 用户手动安装：重新开启自动同步
        if (!options.auto) await setSkillAutoSync(true);
        const results = await installSkill({
          version: PACKAGE_VERSION,
          force: options.force,
          all: options.all || envFlag('APKPUB_FORCE_SKILL_INSTALL'),
        });
        if (options.json) {
          printJson({ ok: results.every((r) => !r.error), version: PACKAGE_VERSION, results });
        } else {
          reportInstall(results, !!options.quiet);
        }
        await exitAfterFlush(results.some((r) => r.error) ? ExitCode.PARTIAL_FAILURE : ExitCode.SUCCESS);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (options.json) printJson({ ok: false, error: { message } });
        else process.stderr.write(`错误: ${message}\n`);
        await exitAfterFlush(ExitCode.INTERNAL);
      }
    });

  skill
    .command('status')
    .description('查看各 Agent 的 skill 安装状态')
    .option('--json', 'JSON 格式输出')
    .action(async (options: { json?: boolean }) => {
      const statuses = await getSkillStatus();
      const autoSync = !(await isSkillAutoSyncDisabled());
      if (options.json) {
        printJson({ version: PACKAGE_VERSION, autoSync, targets: statuses });
      } else {
        if (!autoSync) process.stderr.write(pc.yellow('自动同步已关闭（执行过 skill uninstall）\n'));
        for (const s of statuses) {
          const state = !s.installed
            ? s.detected
              ? pc.yellow('未安装')
              : pc.dim('未检测到 Agent')
            : !s.managed
              ? pc.yellow('旧版安装（下次同步时更新）')
              : s.version === PACKAGE_VERSION
                ? pc.green(`v${s.version}`)
                : pc.yellow(`v${s.version}（当前 CLI 为 v${PACKAGE_VERSION}）`);
          const modified = s.modified.length > 0 ? pc.yellow(`，已修改: ${s.modified.join(', ')}`) : '';
          process.stderr.write(`${s.label.padEnd(7)} ${state}${modified}  ${pc.dim(s.dir)}\n`);
        }
      }
      await exitAfterFlush(ExitCode.SUCCESS);
    });

  skill
    .command('uninstall')
    .description('卸载 skill 并关闭自动同步（保留你自己添加或修改过的文件；再次 install 可重新开启）')
    .option('--force', '同时删除被修改过的文件')
    .option('--json', 'JSON 格式输出')
    .action(async (options: { force?: boolean; json?: boolean }) => {
      const results = await uninstallSkill({ force: options.force });
      // 记录退出，之后的自动同步与 postinstall 都不再装回
      await setSkillAutoSync(false);
      if (options.json) {
        printJson({ ok: true, results });
      } else if (results.length === 0) {
        process.stderr.write('[apkpub] 未发现已安装的 skill；已关闭自动同步\n');
      } else {
        for (const r of results) {
          if (r.unmanaged) {
            process.stderr.write(pc.yellow(`[apkpub] ${r.dir} 为旧版安装（无清单），未自动删除，请手动处理\n`));
            continue;
          }
          process.stderr.write(`[apkpub] 已从 ${r.dir} 移除 ${r.removed.length} 个文件\n`);
          for (const file of r.kept) process.stderr.write(pc.yellow(`  保留已修改文件: ${file}\n`));
        }
        process.stderr.write('[apkpub] 已关闭自动同步；运行 apkpub skill install 可重新安装并开启\n');
      }
      await exitAfterFlush(ExitCode.SUCCESS);
    });
}
