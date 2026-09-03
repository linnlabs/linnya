/**
 * task 命名语义守卫。
 *
 * 代码使用 AST 治理路径、声明/属性标识符、wire key、工具名和 promptKey；
 * 文档与根 HTML 只检查已经退役的精确契约名，普通自然语言不参与检查。
 * 迁移期旧名称必须由按语义维护的允许列表解释。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

import { findTaskNamingAllowance } from './task-naming-allowlist';

export type TaskNamingRuleId =
  | 'TASK-NAMING-01-path'
  | 'TASK-NAMING-02-identifier'
  | 'TASK-NAMING-03-contract-key'
  | 'TASK-NAMING-04-runtime-name'
  | 'TASK-NAMING-05-deprecated-reference';

export interface TaskNamingOccurrence {
  readonly ruleId: TaskNamingRuleId;
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly preview: string;
}

const REPO_ROOT = process.cwd();
const SOURCE_ROOTS = ['src', 'apps', 'packages', 'scripts'] as const;
const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']);
const DOCUMENTATION_EXTENSIONS = new Set(['.md']);
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'dist_build', 'build', 'coverage']);
const AUTHORITY_FILES = new Set([
  'scripts/guards/task-naming-guard.ts',
  'scripts/guards/task-naming-allowlist.ts',
  'scripts/__tests__/task-naming-guard.test.ts',
]);
const THIRD_PARTY_SOURCE_PREFIXES = [
  'packages/plugins/sheet/src/renderer/domain/engine/',
  'apps/renderer/domains/conversation/ui/message/markstream-vue/',
] as const;
const DEPRECATED_CONTRACT_REFERENCES = [
  'taskToolUi',
  'TaskCard',
  'startStatelessTaskRun',
  'is_stateless_task',
  'task_batch',
  'task_subagent',
  'task_general',
  'task_document_editor',
  'task_researcher',
  'task_sheet_editor',
  'task_slides_editor',
  'task_mindmap_editor',
  'AuxiliaryModelTask',
  'auxiliaryModelTasks',
  'getAuxiliaryTask',
  'AUXILIARY_MODEL_TASK',
  '20-task-process-ui',
] as const;

interface SourceChunk {
  readonly content: string;
  readonly lineOffset: number;
  readonly scriptKind: ts.ScriptKind;
  readonly virtualFilePath: string;
}

function normalizeFilePath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function isIgnoredFile(filePath: string): boolean {
  return AUTHORITY_FILES.has(filePath)
    || THIRD_PARTY_SOURCE_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function isGovernedTaskName(name: string): boolean {
  if (/(?:microtask|macrotask|longtask|long_task|tasklist|task_list)/i.test(name)) return false;
  if (/(?:IAgentTask|BaseAgentTask|AgentTaskResolver|AgentTaskConfiguration)/.test(name)) return false;
  return /(^|_)tasks?(_|$)/i.test(name)
    || /^tasks?(?:[A-Z0-9_]|$)/.test(name)
    || /Tasks?(?:[A-Z0-9_]|$)/.test(name)
    || /^TASK(?:S|_)/.test(name);
}

function isGovernedRuntimeLiteral(value: string): boolean {
  return /^(?:task|tasks|task_.+)$/i.test(value)
    || /(?:^|[.:/])task(?:$|[.:/])/.test(value)
    || /^is_stateless_task$/.test(value);
}

function inferScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:js|mjs|cjs)$/.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function inferVueScriptKind(attrs: string): ts.ScriptKind {
  if (/\blang\s*=\s*["']tsx["']/.test(attrs)) return ts.ScriptKind.TSX;
  if (/\blang\s*=\s*["']jsx["']/.test(attrs)) return ts.ScriptKind.JSX;
  if (/\blang\s*=\s*["']js["']/.test(attrs)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function countLinesBefore(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length - 1;
}

function extractSourceChunks(filePath: string, content: string): SourceChunk[] {
  if (!filePath.endsWith('.vue')) {
    return [{ content, lineOffset: 0, scriptKind: inferScriptKind(filePath), virtualFilePath: filePath }];
  }

  const chunks: SourceChunk[] = [];
  const scriptBlockPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptBlockPattern.exec(content)) !== null) {
    const attrs = match[1] ?? '';
    const scriptContent = match[2] ?? '';
    const contentStart = match.index + match[0].indexOf(scriptContent);
    chunks.push({
      content: scriptContent,
      lineOffset: countLinesBefore(content, contentStart),
      scriptKind: inferVueScriptKind(attrs),
      virtualFilePath: `${filePath}.${chunks.length}.ts`,
    });
  }
  return chunks;
}

function isDeclarationOrContractIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) {
    return parent.name === node;
  }
  if ((ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) && parent.name === node) {
    return /^(?:task|tasks|task_id|taskId|task_defaults)$/i.test(node.text);
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return /^(?:task|tasks|task_id|taskId|task_defaults)$/i.test(node.text);
  }
  if (ts.isExportSpecifier(parent)) return true;
  if (
    (ts.isFunctionDeclaration(parent)
      || ts.isClassDeclaration(parent)
      || ts.isInterfaceDeclaration(parent)
      || ts.isTypeAliasDeclaration(parent)
      || ts.isEnumDeclaration(parent))
    && parent.name === node
  ) {
    return parent.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }
  if (ts.isVariableDeclaration(parent) && parent.name === node) {
    const statement = parent.parent.parent;
    return ts.isVariableStatement(statement)
      && (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
  }
  return false;
}

function isContractKeyLiteral(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  return (ts.isPropertyAssignment(parent)
      || ts.isPropertyDeclaration(parent)
      || ts.isPropertySignature(parent)
      || ts.isMethodDeclaration(parent))
    && parent.name === node
    || ts.isElementAccessExpression(parent) && parent.argumentExpression === node;
}

function isRuntimeNameLiteral(node: ts.StringLiteralLike): boolean {
  if (!isGovernedRuntimeLiteral(node.text)) return false;
  const parent = node.parent;
  if (ts.isArrayLiteralExpression(parent)) {
    const owner = parent.parent;
    return (ts.isPropertyAssignment(owner) || ts.isPropertyDeclaration(owner))
      && ts.isIdentifier(owner.name)
      && /^(?:availableTools|tools|promptKeys)$/.test(owner.name.text);
  }
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return /(?:toolName|promptKey|wireKey)$/i.test(parent.name.text);
  }
  if ((ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) && ts.isIdentifier(parent.name)) {
    return /^(?:name|toolName|tool_name|promptKey|source)$/.test(parent.name.text);
  }
  return false;
}

function sourceLine(content: string, line: number): string {
  return content.split(/\r?\n/)[line - 1]?.trim() ?? '';
}

function findDeprecatedContractReferences(filePath: string, content: string): TaskNamingOccurrence[] {
  const normalizedPath = normalizeFilePath(filePath);
  const pathSegments = normalizedPath.split('/');
  const isHistoricalDocument = pathSegments.includes('archive') || pathSegments.includes('research-notes');
  const isGovernedDocument = normalizedPath === 'index.html'
    || (normalizedPath.startsWith('docs/') && !isHistoricalDocument);
  if (!isGovernedDocument) return [];

  return content.split(/\r?\n/).flatMap((lineContent, index) => (
    DEPRECATED_CONTRACT_REFERENCES
      .filter((name) => lineContent.includes(name))
      .map((name) => ({
        ruleId: 'TASK-NAMING-05-deprecated-reference' as const,
        file: normalizedPath,
        line: index + 1,
        name,
        preview: lineContent.trim(),
      }))
  ));
}

function occurrenceFromNode(
  ruleId: TaskNamingRuleId,
  filePath: string,
  sourceFile: ts.SourceFile,
  originalContent: string,
  lineOffset: number,
  node: ts.Node,
  name: string,
): TaskNamingOccurrence {
  const localLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const line = localLine + lineOffset;
  return {
    ruleId,
    file: filePath,
    line,
    name,
    preview: sourceLine(originalContent, line),
  };
}

export function findTaskNamingOccurrences(filePath: string, content: string): TaskNamingOccurrence[] {
  const normalizedPath = normalizeFilePath(filePath);
  const deprecatedReferences = findDeprecatedContractReferences(normalizedPath, content);
  if (!SCANNABLE_EXTENSIONS.has(path.extname(normalizedPath)) || isIgnoredFile(normalizedPath)) {
    return deprecatedReferences;
  }

  const occurrences: TaskNamingOccurrence[] = [...deprecatedReferences];
  for (const segment of normalizedPath.split('/')) {
    const stem = segment.replace(/\.[^.]+$/, '');
    if (isGovernedTaskName(stem)) {
      occurrences.push({
        ruleId: 'TASK-NAMING-01-path',
        file: normalizedPath,
        line: 1,
        name: stem,
        preview: normalizedPath,
      });
      break;
    }
  }

  for (const chunk of extractSourceChunks(normalizedPath, content)) {
    const sourceFile = ts.createSourceFile(
      chunk.virtualFilePath,
      chunk.content,
      ts.ScriptTarget.Latest,
      true,
      chunk.scriptKind,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && isDeclarationOrContractIdentifier(node) && isGovernedTaskName(node.text)) {
        occurrences.push(occurrenceFromNode(
          'TASK-NAMING-02-identifier', normalizedPath, sourceFile, content, chunk.lineOffset, node, node.text,
        ));
      } else if (ts.isStringLiteralLike(node) && isContractKeyLiteral(node) && isGovernedTaskName(node.text)) {
        occurrences.push(occurrenceFromNode(
          'TASK-NAMING-03-contract-key', normalizedPath, sourceFile, content, chunk.lineOffset, node, node.text,
        ));
      } else if (ts.isStringLiteralLike(node) && isRuntimeNameLiteral(node)) {
        occurrences.push(occurrenceFromNode(
          'TASK-NAMING-04-runtime-name', normalizedPath, sourceFile, content, chunk.lineOffset, node, node.text,
        ));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return occurrences;
}

export function findTaskNamingViolations(filePath: string, content: string): TaskNamingOccurrence[] {
  return findTaskNamingOccurrences(filePath, content).filter((occurrence) => (
    findTaskNamingAllowance(occurrence) === undefined
  ));
}

function walk(dir: string, extensions: ReadonlySet<string>, files: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, extensions, files);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
}

function collectTaskNamingOccurrencesFromRepository(
  candidateIncludes?: string,
): TaskNamingOccurrence[] {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) walk(path.join(REPO_ROOT, root), SCANNABLE_EXTENSIONS, files);
  walk(path.join(REPO_ROOT, 'docs'), DOCUMENTATION_EXTENSIONS, files);
  files.push(path.join(REPO_ROOT, 'index.html'));
  return files.flatMap((filePath) => {
    const relativePath = normalizeFilePath(path.relative(REPO_ROOT, filePath));
    const content = fs.readFileSync(filePath, 'utf8');
    if (
      candidateIncludes !== undefined
      && !relativePath.includes(candidateIncludes)
      && !content.includes(candidateIncludes)
    ) {
      return [];
    }
    return findTaskNamingOccurrences(relativePath, content);
  });
}

export function collectTaskNamingOccurrences(): TaskNamingOccurrence[] {
  return collectTaskNamingOccurrencesFromRepository();
}

/**
 * 全仓核对某个精确合同名时，只为可能命中的文件建立 AST。
 *
 * 这里仍遍历所有治理目录，避免允许列表测试因写死文件清单而漏掉新调用方；候选过滤只跳过
 * 文件名和正文都不含目标名称的文件，不改变最终 occurrence 的语义判断。
 */
export function collectTaskNamingOccurrencesByExactName(name: string): TaskNamingOccurrence[] {
  return collectTaskNamingOccurrencesFromRepository(name).filter(
    occurrence => occurrence.name === name
  );
}

export function collectTaskNamingViolations(): TaskNamingOccurrence[] {
  return collectTaskNamingOccurrences().filter(
    occurrence => findTaskNamingAllowance(occurrence) === undefined
  );
}

export function main(): void {
  const violations = collectTaskNamingViolations();
  if (violations.length === 0) {
    console.log('task naming guard passed');
    return;
  }
  for (const violation of violations) {
    console.error(
      `[${violation.ruleId}] ${violation.file}:${violation.line} ${violation.name} | ${violation.preview}`,
    );
  }
  console.error(`task naming guard failed with ${violations.length} violation(s)`);
  process.exitCode = 1;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) main();
