/**
 * 公共源码净化门禁。
 *
 * 门禁按结构识别用户 Home、机器卷、开发 checkout 与 macOS 用户临时目录，
 * 同时阻止已退役的产品身份回流。规则不记录维护者用户名、真实本机路径或旧名称
 * 的完整字面量，也不维护“已知泄露内容”基线。
 */
import { execFileSync } from 'node:child_process';
import fs, { type Stats } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type PublicSourceSanitizationReason =
  | 'absolute-symlink-target'
  | 'machine-volume-path'
  | 'macos-user-temporary-path'
  | 'retired-product-name'
  | 'windows-development-root-path'
  | 'user-home-path';

export interface PublicSourceSanitizationViolation {
  readonly file: string;
  readonly line: number;
  readonly reason: PublicSourceSanitizationReason;
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
const WINDOWS_DEVELOPMENT_ROOT_PATH_PATTERN =
  /(?:file:\/\/\/|(?<![A-Za-z0-9_.@/-]))[A-Za-z]:[\\/]+(?:code|dev|development|projects|repos|source|workspace|workspaces)(?=[\\/])/giu;
const RETIRED_PRODUCT_NAME_PATTERN = new RegExp(
  `(?<![A-Za-z0-9])${['ting', 'talk'].join('')}(?=$|[^A-Za-z0-9])`,
  'giu'
);

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
  reason: PublicSourceSanitizationReason
): PublicSourceSanitizationViolation[] {
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

function collectPatternViolations(
  relativePath: string,
  content: string,
  pattern: RegExp,
  reason: PublicSourceSanitizationReason
): PublicSourceSanitizationViolation[] {
  return Array.from(content.matchAll(pattern)).map(match => ({
    file: relativePath,
    line: resolveLineNumber(content, match.index),
    reason,
  }));
}

export function analyzePublicTextForSourceSanitization(
  relativePath: string,
  content: string
): PublicSourceSanitizationViolation[] {
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
    ...collectPatternViolations(
      relativePath,
      content,
      WINDOWS_DEVELOPMENT_ROOT_PATH_PATTERN,
      'windows-development-root-path'
    ),
    ...collectPatternViolations(
      relativePath,
      content,
      MACOS_USER_TEMPORARY_PATH_PATTERN,
      'macos-user-temporary-path'
    ),
    ...collectPatternViolations(
      relativePath,
      content,
      RETIRED_PRODUCT_NAME_PATTERN,
      'retired-product-name'
    ),
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

export function runPublicSourceSanitizationGuard(
  repoRoot = process.cwd()
): PublicSourceSanitizationViolation[] {
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
      return analyzePublicTextForSourceSanitization(relativePath, target);
    }
    if (!fileStat.isFile()) return [];

    const content = fs.readFileSync(absolutePath);
    if (isBinary(content)) return [];
    return analyzePublicTextForSourceSanitization(relativePath, content.toString('utf8'));
  });
}

function main(): void {
  const violations = runPublicSourceSanitizationGuard();
  if (violations.length === 0) {
    console.log('Public source sanitization guard passed');
    return;
  }

  console.error('公共候选包含本机路径或已退役产品身份：');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line} ${violation.reason}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
