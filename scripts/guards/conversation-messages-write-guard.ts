/**
 * conversation.messages 写入守卫（INV-01）。
 *
 * 用 TypeScript AST 检测对 `<expr>.messages` 的写入，而不是正则匹配文本：
 *
 * - CONV-MSG-01-assign    赋值 / 复合赋值 / 自增自减命中 `.messages` 或 `.messages[i]`
 * - CONV-MSG-02-mutate    在 `.messages` 上调用变异方法（push/splice/...）
 * - CONV-MSG-03-length    写 `.messages.length`
 *
 * 只扫描 Conversation 域的生产代码。测试夹具整体排除——它们本来就要构造状态，
 * 把测试文件混进白名单会让白名单失去语义。
 *
 * 合法边界见 ./conversation-messages-write-allowlist.ts。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

import {
  findConversationMessagesWriteAllowance,
} from './conversation-messages-write-allowlist';

export type ConversationMessagesWriteRuleId =
  | 'CONV-MSG-01-assign'
  | 'CONV-MSG-02-mutate'
  | 'CONV-MSG-03-length';

export interface ConversationMessagesWriteViolation {
  readonly ruleId: ConversationMessagesWriteRuleId;
  readonly file: string;
  readonly line: number;
  readonly preview: string;
}

const REPO_ROOT = process.cwd();

/**
 * 扫描范围：Conversation 域。
 *
 * 域内 `.messages` 是 Conversation 消息缓存的保留属性名。这里刻意采用语法边界，
 * 不引入依赖完整 tsconfig 与 Vue SFC 虚拟文件的类型检查器；其它概念不得在本域复用
 * `messages` 作为可变数组属性名，以免所有权变得含糊。
 */
const SCAN_ROOTS = ['apps/renderer/domains/conversation'] as const;

const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '__snapshots__']);

/** 测试与夹具整体排除：构造状态是它们的职责 */
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/;
const TEST_DIR_SEGMENTS = ['__tests__/', '/testing/', '/fixtures/'];

const MUTATING_ARRAY_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
]);

interface ScriptSlice {
  readonly content: string;
  readonly lineOffset: number;
  readonly scriptKind: ts.ScriptKind;
}

const toPosix = (value: string): string => value.split(path.sep).join('/');

function isTestFile(relativePath: string): boolean {
  if (TEST_FILE_PATTERN.test(relativePath)) return true;
  return TEST_DIR_SEGMENTS.some(segment => `/${relativePath}`.includes(segment));
}

function collectFiles(rootDir: string, acc: string[]): string[] {
  if (!fs.existsSync(rootDir)) return acc;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, acc);
      continue;
    }
    if (SCANNABLE_EXTENSIONS.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

/** .vue 只解析 <script> 块，并保留行偏移以报告真实行号 */
function extractScriptSlices(filePath: string, content: string): ScriptSlice[] {
  if (!filePath.endsWith('.vue')) {
    const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    return [{ content, lineOffset: 0, scriptKind }];
  }

  const slices: ScriptSlice[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const lineOffset = content.slice(0, match.index + (match[0].length - body.length - 9)).split('\n').length - 1;
    slices.push({
      content: body,
      lineOffset,
      scriptKind: /\blang\s*=\s*["']tsx["']/.test(attrs) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    });
  }
  return slices;
}

/** 解开 `(x as T)` / `x!` / `(x)` 等包装，取到真实表达式 */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) { current = current.expression; continue; }
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) { current = current.expression; continue; }
    if (ts.isNonNullExpression(current)) { current = current.expression; continue; }
    return current;
  }
}

const isMessagesAccess = (node: ts.Expression): boolean => {
  const target = unwrap(node);
  if (ts.isPropertyAccessExpression(target)) return target.name.text === 'messages';
  if (ts.isElementAccessExpression(target)) {
    const arg = target.argumentExpression;
    return ts.isStringLiteralLike(arg) && arg.text === 'messages';
  }
  return false;
};

/** `.messages[i]` / `.messages.length` 这类"经由 messages 的写入" */
function isThroughMessages(node: ts.Expression): boolean {
  const target = unwrap(node);
  if (ts.isElementAccessExpression(target)) return isMessagesAccess(target.expression);
  if (ts.isPropertyAccessExpression(target)) return isMessagesAccess(target.expression);
  return false;
}

export function analyzeSource(
  relativePath: string,
  content: string,
): ConversationMessagesWriteViolation[] {
  const violations: ConversationMessagesWriteViolation[] = [];
  const lines = content.split('\n');

  for (const slice of extractScriptSlices(relativePath, content)) {
    const sourceFile = ts.createSourceFile(
      relativePath,
      slice.content,
      ts.ScriptTarget.Latest,
      true,
      slice.scriptKind,
    );

    const lineOf = (node: ts.Node): number =>
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + slice.lineOffset + 1;

    const record = (ruleId: ConversationMessagesWriteRuleId, node: ts.Node): void => {
      const line = lineOf(node);
      violations.push({
        ruleId,
        file: relativePath,
        line,
        preview: (lines[line - 1] ?? '').trim().slice(0, 160),
      });
    };

    const visit = (node: ts.Node): void => {
      // CONV-MSG-01 / 03：赋值与复合赋值
      if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
        const left = unwrap(node.left);
        if (isMessagesAccess(left)) {
          record('CONV-MSG-01-assign', node);
        } else if (isThroughMessages(left)) {
          const isLength = ts.isPropertyAccessExpression(left) && left.name.text === 'length';
          record(isLength ? 'CONV-MSG-03-length' : 'CONV-MSG-01-assign', node);
        }
      }

      // CONV-MSG-01：`.messages[i]++` 之类
      if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
        && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
        && isThroughMessages(node.operand as ts.Expression)
      ) {
        record('CONV-MSG-01-assign', node);
      }

      // CONV-MSG-02：变异方法调用
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        if (
          ts.isPropertyAccessExpression(callee)
          && MUTATING_ARRAY_METHODS.has(callee.name.text)
          && isMessagesAccess(callee.expression)
        ) {
          record('CONV-MSG-02-mutate', node);
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  return violations;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

export function runConversationMessagesWriteGuard(): ConversationMessagesWriteViolation[] {
  const files = SCAN_ROOTS.flatMap(root => collectFiles(path.join(REPO_ROOT, root), []));
  const violations: ConversationMessagesWriteViolation[] = [];

  for (const absolute of files) {
    const relativePath = toPosix(path.relative(REPO_ROOT, absolute));
    if (isTestFile(relativePath)) continue;
    if (findConversationMessagesWriteAllowance(relativePath)) continue;

    violations.push(...analyzeSource(relativePath, fs.readFileSync(absolute, 'utf8')));
  }

  return violations;
}

function main(): void {
  const violations = runConversationMessagesWriteGuard();
  if (violations.length === 0) {
    console.log('✓ conversation.messages write guard: no violations');
    return;
  }

  console.error('✗ conversation.messages 写入越界（违反 INV-01）\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.ruleId}]`);
    console.error(`      ${v.preview}`);
  }
  console.error(
    '\nconversation.messages 是派生缓存，不是事实源。合法写入只有两处：'
    + '\n  · services/messageProjection/**        reducer 隔离工作区'
    + '\n  · services/orchestration/projectionCommitPipeline.ts   Vue live slot 提交出口'
    + '\n\n请改为经投影系统变更（如 truncateProjectionStateAfterMessage()）。'
    + '\n详见 docs/conversation-platform/00-invariants.md#inv-01\n',
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
