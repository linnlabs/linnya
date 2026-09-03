/**
 * Agent codename lint.
 *
 * 目标：
 * - 防止历史代号 `linngent` 渗进任何代码（兼容期临时代号，最终要清零）
 * - `linnkit` 已是正式包名 + 公开 API namespace（如 `linnkitCompat` named export），
 *   不再当作 codename 处理；任何文件都可以自由使用，不在本 lint 关心范围内。
 *
 * 历史背景：早期 `linnkit` 是临时代号，需要防止它在前端/业务代码里硬编码。
 * 自 D-1.b 起，决策已 finalize 为正式包名（见 packages/linnkit/src/docs/00-vision-and-split.md §4.1），
 * 继续禁会和"它是公开 API 的一部分"自相矛盾。
 *
 * - 只允许 codename 出现在权威定义文件或验证这些权威定义的测试里
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type CodenameViolation = {
  file: string;
  line: number;
  symbol: string;
  preview: string;
};

const repoRoot = process.cwd();
/**
 * 当前禁止泄漏的 codename 列表。
 *
 * - `linngent`: 早期历史代号（兼容期），最终要清零。
 *
 * 注意：`linnkit` 不在此列——它已是正式包名（见 file-level JSDoc）。
 */
const CODE_NAMES = ['linngent'] as const;

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist_build',
  'build',
  'temp',
  'temp_ts_build',
  'temp_tsup',
]);

const AUTHORITY_FILES = new Set([
  'scripts/guards/agent-codename-lint.ts',
  'scripts/__tests__/agent-codename-lint.test.ts',
  'packages/linnkit/src/index.ts',
  'packages/linnkit/src/__tests__/index.exports.snapshot.test.ts',
  'packages/linnkit/src/__tests__/package.manifest.test.ts',
  'src/agent/index.ts',
  'src/agent/__tests__/index.exports.snapshot.test.ts',
  'src/agent/__tests__/package.manifest.test.ts',
]);

const SCANNABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
]);

function rel(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll('\\', '/');
}

function normalizeFilePath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function isScannableFile(filePath: string): boolean {
  return SCANNABLE_EXTENSIONS.has(path.extname(filePath));
}

export function isCodenameAuthorityFile(filePath: string): boolean {
  return AUTHORITY_FILES.has(normalizeFilePath(filePath));
}

function walk(dir: string, out: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      walk(fullPath, out);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (isScannableFile(fullPath)) {
      out.push(fullPath);
    }
  }
}

function matchedCodeNames(preview: string): string[] {
  return CODE_NAMES.filter((symbol) => preview.includes(symbol));
}

export function findCodenameViolations(filePath: string, content: string): CodenameViolation[] {
  const normalizedFilePath = normalizeFilePath(filePath);
  if (!isScannableFile(normalizedFilePath) || isCodenameAuthorityFile(normalizedFilePath)) {
    return [];
  }

  const violations: CodenameViolation[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const preview = lines[index];
    if (!preview) {
      continue;
    }

    for (const symbol of matchedCodeNames(preview)) {
      violations.push({
        file: normalizedFilePath,
        line: index + 1,
        symbol,
        preview: preview.trim(),
      });
    }
  }

  return violations;
}

function collectViolations(): CodenameViolation[] {
  const files: string[] = [];
  walk(repoRoot, files);

  const violations: CodenameViolation[] = [];
  for (const file of files) {
    const relativeFilePath = rel(file);
    const content = fs.readFileSync(file, 'utf8');
    violations.push(...findCodenameViolations(relativeFilePath, content));
  }

  return violations;
}

function formatViolation(violation: CodenameViolation): string {
  return `[AGENT-CODENAME-01-no-hardcoded-codename] ${violation.file}:${violation.line} ${violation.preview}`;
}

export function main(): void {
  const violations = collectViolations();
  if (violations.length === 0) {
    console.log('agent codename lint passed');
    return;
  }

  for (const violation of violations) {
    console.error(formatViolation(violation));
  }
  process.exitCode = 1;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main();
}
