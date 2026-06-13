#!/usr/bin/env node
// 将随包发布的 skill 同步（复制）到各 AI Agent 的 skills 目录。
// 该脚本由 npm/pnpm 的 postinstall 钩子自动触发，也可手动执行：
//   node scripts/install-skill.mjs
//
// 行为约定：
// - 仅当某 Agent 的配置目录已存在（说明用户在用该 Agent）时才安装，避免污染。

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  statSync,
} from 'node:fs';

const SKILL_NAME = 'using-apkpub-cli';

/** 判断环境变量是否为真值 */
function envFlag(name) {
  const v = process.env[name];
  return v === '1' || v === 'true' || v === 'yes';
}

/** 解析随包发布的 skill 源目录 */
function resolveSourceDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  // scripts/ 与 skills/ 同级，均位于包根目录下
  return join(here, '..', 'skills', SKILL_NAME);
}

/**
 * 目标 Agent 列表。
 * agentDir：Agent 的配置根目录（用于探测该 Agent 是否被使用）。
 * skillsDir：该 Agent 的 skills 目录（实际安装位置）。
 */
function getTargets() {
  const home = homedir();
  const targets = [
    { label: 'agents', agentDir: join(home, '.agents'), skillsDir: join(home, '.agents', 'skills') },
    { label: 'cursor', agentDir: join(home, '.cursor'), skillsDir: join(home, '.cursor', 'skills') },
    { label: 'hermes', agentDir: join(home, '.hermes'), skillsDir: join(home, '.hermes', 'skills') },
    { label: 'claude', agentDir: join(home, '.claude'), skillsDir: join(home, '.claude', 'skills') },
  ];

  // 允许通过环境变量追加自定义安装根目录（其下会创建 <dir>/<SKILL_NAME>）
  const extra = (process.env.APKPUB_SKILL_DIRS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const dir of extra) {
    targets.push({ label: 'custom', agentDir: dir, skillsDir: dir, alwaysInstall: true });
  }
  return targets;
}

/** 递归复制目录 */
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  if (envFlag('APKPUB_SKIP_SKILL_INSTALL')) return;

  const source = resolveSourceDir();
  if (!existsSync(source)) return;

  const force = envFlag('APKPUB_FORCE_SKILL_INSTALL');
  const installed = [];

  for (const target of getTargets()) {
    try {
      // 仅在该 Agent 已安装（配置目录存在）或强制模式下安装
      const shouldInstall = force || target.alwaysInstall || existsSync(target.agentDir);
      if (!shouldInstall) continue;

      const dest = join(target.skillsDir, SKILL_NAME);
      copyDir(source, dest);
      installed.push(dest);
    } catch {
      // 单个目标失败忽略，不影响其他目标与安装流程
    }
  }

  if (installed.length > 0) {
    // 输出到 stderr，避免污染依赖方的 stdout
    process.stderr.write(`[apkpub] 已同步 skill "${SKILL_NAME}" 到:\n`);
    for (const p of installed) process.stderr.write(`  - ${p}\n`);
  }
}

try {
  main();
} catch {
  // postinstall 永不阻断安装
}
