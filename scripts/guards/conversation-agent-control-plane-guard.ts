/**
 * Conversation Agent 控制面守卫（INV-16 / INV-55）。
 *
 * 会话级 Agent 选择只能通过 selected_agent_id / selectedAgentId 表达：
 * - metadata.promptKey 不得重新成为 Renderer read model 控制面；
 * - conversationAgentChoices contribution 不得暴露内部 promptKey。
 *
 * 一次性运行、subrun 和 Host admission 后的 promptKey 是合法执行参数，本守卫不会全仓禁用它。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export type ConversationAgentControlPlaneRuleId =
  | 'AGENT-CONTROL-01-metadata-prompt-key'
  | 'AGENT-CONTROL-02-contribution-prompt-key';

export interface ConversationAgentControlPlaneViolation {
  readonly ruleId: ConversationAgentControlPlaneRuleId;
  readonly file: string;
  readonly line: number;
  readonly preview: string;
}

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = [
  'apps/renderer/domains/conversation',
  'apps/renderer/app/plugins',
  'packages/plugin-host-contract/renderer',
  'packages/plugins',
  'src/plugin-sdk/renderer',
] as const;
const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '__snapshots__']);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/u;
const TEST_DIR_SEGMENTS = ['__tests__/', '/testing/', '/fixtures/'];

interface ScriptSlice {
  readonly content: string;
  readonly lineOffset: number;
  readonly scriptKind: ts.ScriptKind;
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function isTestFile(relativePath: string): boolean {
  if (TEST_FILE_PATTERN.test(relativePath)) return true;
  return TEST_DIR_SEGMENTS.some(segment => `/${relativePath}`.includes(segment));
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

function extractScriptSlices(filePath: string, content: string): ScriptSlice[] {
  if (!filePath.endsWith('.vue')) {
    return [{
      content,
      lineOffset: 0,
      scriptKind: filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    }];
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

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
    } else if (ts.isNonNullExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

function propertyNameText(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
}

function accessedPropertyName(expression: ts.Expression): string | null {
  const target = unwrap(expression);
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  if (ts.isElementAccessExpression(target)) {
    const argument = target.argumentExpression;
    return ts.isStringLiteralLike(argument) ? argument.text : null;
  }
  return null;
}

function accessOwner(expression: ts.Expression): ts.Expression | null {
  const target = unwrap(expression);
  if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    return target.expression;
  }
  return null;
}

function isMetadataAccess(expression: ts.Expression): boolean {
  return accessedPropertyName(expression) === 'metadata';
}

function isMetadataPromptKeyAccess(expression: ts.Expression): boolean {
  if (accessedPropertyName(expression) !== 'promptKey') return false;
  const owner = accessOwner(expression);
  return owner !== null && isMetadataAccess(unwrap(owner));
}

function bindingContainsPromptKey(pattern: ts.ObjectBindingPattern): boolean {
  return pattern.elements.some((element) =>
    propertyNameText(element.propertyName ?? element.name) === 'promptKey'
  );
}

function isPromptKeyProperty(node: ts.Node): boolean {
  return (ts.isPropertyAssignment(node)
      || ts.isShorthandPropertyAssignment(node)
      || ts.isMethodDeclaration(node)
      || ts.isGetAccessorDeclaration(node)
      || ts.isSetAccessorDeclaration(node))
    && propertyNameText(node.name) === 'promptKey';
}

function callName(expression: ts.Expression): string | null {
  const target = unwrap(expression);
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  return null;
}

function isMetadataPatchPromptKey(node: ts.Node): boolean {
  if (!isPromptKeyProperty(node) || !ts.isObjectLiteralExpression(node.parent)) return false;
  const objectLiteral = node.parent;
  const container = objectLiteral.parent;
  if (ts.isPropertyAssignment(container) && propertyNameText(container.name) === 'metadata') {
    return true;
  }
  return ts.isCallExpression(container)
    && callName(container.expression) === 'mergeConversationMetadata'
    && container.arguments.includes(objectLiteral);
}

function collectContributionPromptKeys(node: ts.Node): ts.Node[] {
  if (!ts.isPropertyAssignment(node) || propertyNameText(node.name) !== 'conversationAgentChoices') {
    return [];
  }
  const found: ts.Node[] = [];
  const visit = (child: ts.Node): void => {
    if (isPromptKeyProperty(child)) found.push(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node.initializer, visit);
  return found;
}

export function analyzeConversationAgentControlPlane(
  relativePath: string,
  content: string,
): ConversationAgentControlPlaneViolation[] {
  const violations: ConversationAgentControlPlaneViolation[] = [];
  const sourceLines = content.split(/\r?\n/u);

  for (const slice of extractScriptSlices(relativePath, content)) {
    const sourceFile = ts.createSourceFile(
      relativePath,
      slice.content,
      ts.ScriptTarget.Latest,
      true,
      slice.scriptKind,
    );
    const recorded = new Set<string>();

    const record = (ruleId: ConversationAgentControlPlaneRuleId, node: ts.Node): void => {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
        + slice.lineOffset
        + 1;
      const key = `${ruleId}:${line}:${node.getStart(sourceFile)}`;
      if (recorded.has(key)) return;
      recorded.add(key);
      violations.push({
        ruleId,
        file: relativePath,
        line,
        preview: (sourceLines[line - 1] ?? '').trim().slice(0, 160),
      });
    };

    const visit = (node: ts.Node): void => {
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        && isMetadataPromptKeyAccess(node)
      ) {
        record('AGENT-CONTROL-01-metadata-prompt-key', node);
      }
      if (
        ts.isVariableDeclaration(node)
        && ts.isObjectBindingPattern(node.name)
        && node.initializer
        && isMetadataAccess(node.initializer)
        && bindingContainsPromptKey(node.name)
      ) {
        record('AGENT-CONTROL-01-metadata-prompt-key', node);
      }
      if (isMetadataPatchPromptKey(node)) {
        record('AGENT-CONTROL-01-metadata-prompt-key', node);
      }
      for (const promptKey of collectContributionPromptKeys(node)) {
        record('AGENT-CONTROL-02-contribution-prompt-key', promptKey);
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  return violations;
}

export function runConversationAgentControlPlaneGuard(): ConversationAgentControlPlaneViolation[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) collectFiles(path.join(REPO_ROOT, root), files);
  return files.flatMap((absolute) => {
    const relativePath = toPosix(path.relative(REPO_ROOT, absolute));
    if (isTestFile(relativePath)) return [];
    return analyzeConversationAgentControlPlane(relativePath, fs.readFileSync(absolute, 'utf8'));
  });
}

function main(): void {
  const violations = runConversationAgentControlPlaneGuard();
  if (violations.length === 0) {
    console.log('✓ Conversation Agent control-plane guard: no violations');
    return;
  }

  console.error('✗ Conversation Agent 控制面旁路（违反 INV-16 / INV-55）\n');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  [${violation.ruleId}]`);
    console.error(`      ${violation.preview}`);
  }
  console.error(
    '\n会话级 Agent 选择只能通过 selected_agent_id / selectedAgentId 表达；'
    + '\nmetadata 只承载展示与上下文数据，contribution 只引用 AgentDefinition.id。'
    + '\n详见 docs/conversation-platform/00-invariants.md#inv-16\n',
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
