/**
 * 公共源码本机路径泄露门禁。
 *
 * 门禁按路径结构识别用户 Home、机器卷与 macOS 用户临时目录，不记录任何维护者
 * 用户名，也不维护“已知泄露路径”基线。文档和测试可以使用明确的公共占位符。
 */
import { execFileSync } from 'node:child_process';
import fs, { type Stats } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type PublicLocalPathLeakReason =
  | 'absolute-symlink-target'
  | 'machine-volume-path'
  | 'macos-user-temporary-path'
  | 'user-home-path';

export interface PublicLocalPathLeakViolation {
  readonly file: string;
  readonly line: number;
  readonly reason: PublicLocalPathLeakReason;
}

const PUBLIC_PLACEHOLDER_SEGMENTS = new Set([
  'example',
  'linnya',
  'linnya_test',
  'me',
  'name',
  'person',
  'private',
  'test',
  'user',
  'username',
  'you',
]);

const USER_HOME_PATH_PATTERN =
  /(?:file:\/\/\/|(?<![A-Za-z0-9_.@/-])\/)(?:Users|home)\/([^/\\\s"'`]+)/giu;
const WINDOWS_USER_HOME_PATH_PATTERN =
  /(?:file:\/\/\/)?[A-Za-z]:[\\/]+Users[\\/]+([^/\\\s"'`]+)/giu;
const MACHINE_VOLUME_PATH_PATTERN =
  /(?:file:\/\/\/|(?<![A-Za-z0-9_.@/-])\/)(?:Volumes|media|mnt)\/([^/\\\s"'`]+)/giu;
const MACOS_USER_TEMPORARY_PATH_PATTERN =
  /(?:file:\/\/\/|(?<![A-Za-z0-9_.@/-])\/)(?:private\/)?var\/folders(?:\/|(?=[\s"'`]))/giu;

function isPublicPlaceholderSegment(segment: string): boolean {
  const normalized = segment.toLowerCase();
  return (
    PUBLIC_PLACEHOLDER_SEGMENTS.has(normalized) ||
    /^<[^>]+>$/u.test(segment) ||
    /^\$\{[^}]+\}$/u.test(segment) ||
    /^\$[A-Za-z_][A-Za-z0-9_]*$/u.test(segment) ||
    /^%[^%]+%$/u.test(segment)
  );
}

function resolveLineNumber(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function collectSegmentPathViolations(
  relativePath: string,
  content: string,
  pattern: RegExp,
  reason: PublicLocalPathLeakReason
): PublicLocalPathLeakViolation[] {
  return Array.from(content.matchAll(pattern))
    .filter(match => {
      const segment = match[1];
      return segment != null && !isPublicPlaceholderSegment(segment);
    })
    .map(match => ({
      file: relativePath,
      line: resolveLineNumber(content, match.index),
      reason,
    }));
}

export function analyzePublicTextForLocalPathLeaks(
  relativePath: string,
  content: string
): PublicLocalPathLeakViolation[] {
  return [
    ...collectSegmentPathViolations(
      relativePath,
      content,
      USER_HOME_PATH_PATTERN,
      'user-home-path'
    ),
    ...collectSegmentPathViolations(
      relativePath,
      content,
      WINDOWS_USER_HOME_PATH_PATTERN,
      'user-home-path'
    ),
    ...collectSegmentPathViolations(
      relativePath,
      content,
      MACHINE_VOLUME_PATH_PATTERN,
      'machine-volume-path'
    ),
    ...Array.from(content.matchAll(MACOS_USER_TEMPORARY_PATH_PATTERN)).map(match => ({
      file: relativePath,
      line: resolveLineNumber(content, match.index),
      reason: 'macos-user-temporary-path' as const,
    })),
  ];
}

function listPublicCandidateFiles(repoRoot: string): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function isBinary(content: Buffer): boolean {
  return content.includes(0);
}

function isMissingCandidateFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function runPublicLocalPathLeakGuard(
  repoRoot = process.cwd()
): PublicLocalPathLeakViolation[] {
  return listPublicCandidateFiles(repoRoot).flatMap(relativePath => {
    const absolutePath = path.join(repoRoot, ...relativePath.split('/'));
    let fileStat: Stats;
    try {
      fileStat = fs.lstatSync(absolutePath);
    } catch (error: unknown) {
      // Git 的 index 仍会列出工作树中刚删除、尚未提交的文件；候选树里已不存在，无需扫描。
      if (isMissingCandidateFile(error)) return [];
      throw error;
    }

    if (fileStat.isSymbolicLink()) {
      const target = fs.readlinkSync(absolutePath);
      if (path.isAbsolute(target) || path.win32.isAbsolute(target)) {
        return [{ file: relativePath, line: 1, reason: 'absolute-symlink-target' }];
      }
      return analyzePublicTextForLocalPathLeaks(relativePath, target);
    }
    if (!fileStat.isFile()) return [];

    const content = fs.readFileSync(absolutePath);
    if (isBinary(content)) return [];
    return analyzePublicTextForLocalPathLeaks(relativePath, content.toString('utf8'));
  });
}

function main(): void {
  const violations = runPublicLocalPathLeakGuard();
  if (violations.length === 0) {
    console.log('Public local path leak guard passed');
    return;
  }

  console.error('公共候选包含疑似开发者本机绝对路径：');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line} ${violation.reason}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
