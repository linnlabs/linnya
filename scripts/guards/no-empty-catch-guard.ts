/**
 * 空 catch 门禁。
 *
 * 第一阶段禁止完全空白的 `catch {}`。仓库仍有一批仅含历史说明注释的 catch，
 * 它们不等于可观察性，但跨多个稳定业务域，需按真实失败语义分批治理，不能在本门禁中
 * 用大规模日志补丁清场。新代码至少必须明确说明为何可以忽略，关键链路仍应记录、转换
 * 或重新抛出错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export interface EmptyCatchViolation {
  readonly file: string;
  readonly line: number;
  readonly preview: string;
}

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ['apps', 'src', 'packages', 'scripts'] as const;
const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'coverage', '__snapshots__']);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/;

interface ScriptSlice {
  readonly content: string;
  readonly lineOffset: number;
  readonly scriptKind: ts.ScriptKind;
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function extractScriptSlices(filePath: string, content: string): ScriptSlice[] {
  if (!filePath.endsWith('.vue')) {
    return [{ content, lineOffset: 0, scriptKind: scriptKindFor(filePath) }];
  }

  const slices: ScriptSlice[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const bodyStart = match.index + match[0].indexOf('>') + 1;
    const lineOffset = content.slice(0, bodyStart).split(/\r?\n/).length - 1;
    const scriptKind = /\blang\s*=\s*["']tsx["']/.test(attrs)
      ? ts.ScriptKind.TSX
      : /\blang\s*=\s*["'](?:js|jsx)["']/.test(attrs)
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.TS;
    slices.push({ content: body, lineOffset, scriptKind });
  }
  return slices;
}

export function analyzeEmptyCatchSource(
  relativePath: string,
  content: string,
): EmptyCatchViolation[] {
  const violations: EmptyCatchViolation[] = [];
  const lines = content.split(/\r?\n/);

  for (const slice of extractScriptSlices(relativePath, content)) {
    const sourceFile = ts.createSourceFile(
      relativePath,
      slice.content,
      ts.ScriptTarget.Latest,
      true,
      slice.scriptKind,
    );

    const visit = (node: ts.Node): void => {
      const blockText = ts.isCatchClause(node) ? node.block.getText(sourceFile) : '';
      const hasExplicitComment = /\/\/|\/\*/.test(blockText);
      if (ts.isCatchClause(node) && node.block.statements.length === 0 && !hasExplicitComment) {
        const localLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
        const line = localLine + slice.lineOffset + 1;
        violations.push({
          file: relativePath,
          line,
          preview: (lines[line - 1] ?? '').trim().slice(0, 160),
        });
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  return violations;
}

function collectFiles(rootDir: string, files: string[]): void {
  if (!fs.existsSync(rootDir)) return;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue;
    const absolute = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(absolute, files);
    } else if (SCANNABLE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
}

export function runNoEmptyCatchGuard(): EmptyCatchViolation[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) collectFiles(path.join(REPO_ROOT, root), files);

  return files.flatMap((absolute) => {
    const relativePath = path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
    if (TEST_FILE_PATTERN.test(relativePath) || relativePath.includes('/__tests__/')) return [];
    return analyzeEmptyCatchSource(relativePath, fs.readFileSync(absolute, 'utf8'));
  });
}

function main(): void {
  const violations = runNoEmptyCatchGuard();
  if (violations.length === 0) {
    console.log('no-empty-catch guard passed');
    return;
  }

  console.error('空 catch 会吞掉失败上下文：');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}`);
    console.error(`    ${violation.preview}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
