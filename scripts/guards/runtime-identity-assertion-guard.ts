/**
 * Runtime 身份断言守卫（INV-58）。
 *
 * brand 只能由身份 owner 的 strict schema 或正式 creator/派生函数产生。生产代码不得：
 * - 直接把字符串断言成 RunId / ToolCallId；
 * - 把未知对象整体断言成携带这些身份的核心载体，借此绕过字段 admission。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'apps/renderer'] as const;
const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue']);
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '__snapshots__',
  '__tests__',
  '__test-helpers__',
  'testkit',
  'fixtures',
]);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/u;

const IDENTITY_TYPES = new Set(['RunId', 'ToolCallId']);
const CARRIER_TYPES = new Set([
  'RuntimeEvent',
  'RoutedRuntimeEvent',
  'SSEEvent',
  'RunRecord',
  'RunMeta',
  'StandardToolCall',
]);

export type RuntimeIdentityAssertionRule =
  | 'RUNTIME-ID-01-direct-assertion'
  | 'RUNTIME-ID-02-carrier-assertion';

export interface RuntimeIdentityAssertionViolation {
  readonly rule: RuntimeIdentityAssertionRule;
  readonly file: string;
  readonly line: number;
  readonly preview: string;
}

interface ScriptSlice {
  readonly content: string;
  readonly lineOffset: number;
  readonly scriptKind: ts.ScriptKind;
}

function collectFiles(rootDir: string, files: string[]): string[] {
  if (!fs.existsSync(rootDir)) return files;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue;
    const absolute = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(absolute, files);
    } else if (
      SCANNABLE_EXTENSIONS.has(path.extname(entry.name)) &&
      !TEST_FILE_PATTERN.test(entry.name)
    ) {
      files.push(absolute);
    }
  }
  return files;
}

function extractScriptSlices(filePath: string, content: string): ScriptSlice[] {
  if (!filePath.endsWith('.vue')) {
    return [
      {
        content,
        lineOffset: 0,
        scriptKind: filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      },
    ];
  }

  const slices: ScriptSlice[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/giu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const bodyStart = match.index + match[0].indexOf('>') + 1;
    slices.push({
      content: body,
      lineOffset: content.slice(0, bodyStart).split(/\r?\n/u).length - 1,
      scriptKind: /\blang\s*=\s*["']tsx["']/u.test(attrs) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    });
  }
  return slices;
}

function collectAssertedTypeNames(typeNode: ts.TypeNode, names: Set<string>): void {
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName;
    names.add(ts.isIdentifier(typeName) ? typeName.text : typeName.right.text);
  }
  ts.forEachChild(typeNode, child => {
    if (ts.isTypeNode(child)) collectAssertedTypeNames(child, names);
  });
}

export function analyzeRuntimeIdentityAssertions(
  relativePath: string,
  content: string
): RuntimeIdentityAssertionViolation[] {
  const violations: RuntimeIdentityAssertionViolation[] = [];
  const lines = content.split(/\r?\n/u);

  for (const slice of extractScriptSlices(relativePath, content)) {
    const sourceFile = ts.createSourceFile(
      relativePath,
      slice.content,
      ts.ScriptTarget.Latest,
      true,
      slice.scriptKind
    );

    const visit = (node: ts.Node): void => {
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        const assertedNames = new Set<string>();
        collectAssertedTypeNames(node.type, assertedNames);
        const rule = [...assertedNames].some(name => IDENTITY_TYPES.has(name))
          ? 'RUNTIME-ID-01-direct-assertion'
          : [...assertedNames].some(name => CARRIER_TYPES.has(name))
            ? 'RUNTIME-ID-02-carrier-assertion'
            : undefined;

        if (rule) {
          const localLine = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile)
          ).line;
          const line = localLine + slice.lineOffset + 1;
          violations.push({
            rule,
            file: relativePath,
            line,
            preview: (lines[line - 1] ?? '').trim().slice(0, 160),
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  return violations;
}

export function runRuntimeIdentityAssertionGuard(): RuntimeIdentityAssertionViolation[] {
  const violations: RuntimeIdentityAssertionViolation[] = [];
  for (const root of SCAN_ROOTS) {
    const files = collectFiles(path.join(REPO_ROOT, root), []);
    for (const absolute of files) {
      const relativePath = path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
      violations.push(
        ...analyzeRuntimeIdentityAssertions(relativePath, fs.readFileSync(absolute, 'utf8'))
      );
    }
  }
  return violations;
}

function main(): void {
  const violations = runRuntimeIdentityAssertionGuard();
  if (violations.length === 0) {
    console.log('✓ runtime identity assertion guard: no violations');
    return;
  }

  console.error('✗ Runtime 身份断言绕过（违反 INV-58）\n');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  [${violation.rule}]`);
    console.error(`      ${violation.preview}`);
  }
  console.error(
    '\n请在外部/持久化边界调用身份 owner 的 schema，或使用正式 generator/派生函数。' +
      '\n不得通过核心载体断言间接获得 branded identity。' +
      '\n详见 docs/conversation-platform/00-invariants.md#inv-58\n'
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
