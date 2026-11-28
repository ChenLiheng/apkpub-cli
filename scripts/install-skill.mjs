#!/usr/bin/env node
// npm / pnpm 的 postinstall 钩子：调用 `apkpub skill install` 同步随包发布的 Agent skill。
// 安装逻辑统一在 CLI 内（src/skill/installer.ts），这里只负责调用；也可手动执行：
//   node scripts/install-skill.mjs
//
// 说明：pnpm 10 / bun 默认不执行依赖的安装脚本，此时 CLI 首次运行时会自动补齐同步。
// 环境变量：
//   APKPUB_SKIP_SKILL_INSTALL=1   跳过同步
//   APKPUB_FORCE_SKILL_INSTALL=1  为所有支持的 Agent 安装，即使未检测到其配置目录
//   APKPUB_SKILL_DIRS=a,b         追加自定义 skills 根目录

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function main() {
  const v = process.env.APKPUB_SKIP_SKILL_INSTALL;
  if (v === '1' || v === 'true' || v === 'yes') return;

  const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'apkpub.js');
  // 源码仓库内首次安装时尚未构建，跳过即可
  if (!existsSync(cli)) return;

  // --auto：用户执行过 apkpub skill uninstall 时不装回
  spawnSync(process.execPath, [cli, 'skill', 'install', '--quiet', '--auto'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    timeout: 30_000,
  });
}

try {
  main();
} catch {
  // postinstall 永不阻断安装
}
