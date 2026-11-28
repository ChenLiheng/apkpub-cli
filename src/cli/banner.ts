import pc from 'picocolors';
import { PACKAGE_VERSION } from '../version.js';

// ASCII 字标（ANSI Shadow 字体）
const LOGO = [
  ' █████╗ ██████╗ ██╗  ██╗██████╗ ██╗   ██╗██████╗ ',
  '██╔══██╗██╔══██╗██║ ██╔╝██╔══██╗██║   ██║██╔══██╗',
  '███████║██████╔╝█████╔╝ ██████╔╝██║   ██║██████╔╝',
  '██╔══██║██╔═══╝ ██╔═██╗ ██╔═══╝ ██║   ██║██╔══██╗',
  '██║  ██║██║     ██║  ██╗██║     ╚██████╔╝██████╔╝',
  '╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝      ╚═════╝ ╚═════╝ ',
];

/** 生成根命令 --help 顶部展示的 Banner（颜色随 picocolors 自动适配 NO_COLOR / 非 TTY） */
export function renderBanner(): string {
  const logo = LOGO.map((line) => pc.green(line)).join('\n');
  const tagline = `${pc.bold('APK 多市场分发 CLI')} ${pc.dim(`v${PACKAGE_VERSION}`)}`;
  const channels = pc.dim('华为 · 小米 · OPPO · VIVO · 荣耀 · 自定义渠道（OSS / HTTP）');
  return `\n${logo}\n\n  ${tagline}\n  ${channels}\n`;
}
