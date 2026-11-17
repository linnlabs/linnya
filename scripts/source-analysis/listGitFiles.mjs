import { execFileSync } from 'node:child_process';

// 仓库文件清单已接近 1 MiB，超过 Node 默认输出上限时 execFileSync 会直接抛错。
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * 运行 `git ls-files -z <args>` 并返回路径数组。脚本和门禁列 Git 文件都走这里：
 * `-z` 让中文等非 ASCII 路径保持原样（不加时 Git 会转义成 "\344\270…"），输出上限统一放宽。
 * 只要工作区里实际存在的自有文件时用 listWorkingTreePaths。
 */
export function listGitFiles(args, options = {}) {
  return execFileSync('git', ['ls-files', '-z', ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
  }).split('\0').filter(Boolean);
}
