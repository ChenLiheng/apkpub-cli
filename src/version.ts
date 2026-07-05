import { readFileSync } from 'node:fs';

interface PackageJson {
  version?: string;
}

/** 从 package.json 读取当前包版本 */
export function getPackageVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(raw) as PackageJson;
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const PACKAGE_VERSION = getPackageVersion();
