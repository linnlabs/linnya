/**
 * Conversation Vue 响应式边界守卫（INV-17 / INV-54）。
 *
 * Vue 组件不是协议接纳边界：
 * - Zod schema 的 parse/safeParse 与公开 parse 函数不得出现在 `.vue` 中；
 * - 生产 `.ts` composable 的 computed/watch/watchEffect 内同样不得 parse 或抛业务异常。
 *
 * 普通点击事件可以显式失败，JSON.parse 也不属于 schema admission，因此不在本守卫范围内。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = process.cwd();
const SCAN_ROOT = 'apps/renderer/domains/conversation';
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '__snapshots__']);
const REACTIVE_APIS = new Set([
  'computed',
  'watch',
  'watchEffect',
  'watchPostEffect',
  'watchSyncEffect',
]);

export type ConversationVueReactiveBoundaryRule =
  | 'CONV-VUE-01-schema-parse'
  | 'CONV-VUE-02-reactive-throw';

export interface ConversationVueReactiveBoundaryViolation {
  readonly rule: ConversationVueReactiveBoundaryRule;
  readonly file: string;
  readonly line: number;
  readonly preview: string;
}

interface ScriptSlice {
  readonly content: string;
  readonly lineOffset: number;
}

type LocalFunction = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

interface SchemaImports {
  readonly bindings: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
  readonly parserBindings: ReadonlySet<string>;
}

function collectProductionReactiveFiles(rootDir: string, files: string[]): string[] {
  if (!fs.existsSync(rootDir)) return files;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue;
    const absolute = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'testing') {
        collectProductionReactiveFiles(absolute, files);
      }
    } else if (
      entry.name.endsWith('.vue') ||
      (entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.spec.ts'))
    ) {
      files.push(absolute);
    }
  }
  return files;
}

/** 只解析 Vue script 块，并保留 SFC 中的真实行号。 */
function extractVueScripts(content: string): ScriptSlice[] {
  const slices: ScriptSlice[] = [];
  const pattern = /<script\b[^>]*>([\s\S]*?)<\/script>/giu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const body = match[1] ?? '';
    const bodyStart = match.index + match[0].indexOf('>') + 1;
    slices.push({
      content: body,
      lineOffset: content.slice(0, bodyStart).split(/\r?\n/u).length - 1,
    });
  }
  return slices;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function expressionName(expression: ts.Expression): string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  return undefined;
}

function collectSchemaImports(sourceFile: ts.SourceFile): SchemaImports {
  const bindings = new Set<string>();
  const namespaces = new Set<string>();
  const parserBindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    if (statement.moduleSpecifier.text !== '@app/schemas') continue;
    const importClause = statement.importClause;
    const namedBindings = importClause?.namedBindings;
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      namespaces.add(namedBindings.name.text);
    }
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (importedName.endsWith('Schema')) bindings.add(element.name.text);
        if (importedName.startsWith('parse')) parserBindings.add(element.name.text);
      }
    }
  }
  return { bindings, namespaces, parserBindings };
}

function isSchemaParseCall(node: ts.CallExpression, imports: SchemaImports): boolean {
  const callee = unwrapExpression(node.expression);
  if (ts.isIdentifier(callee) && imports.parserBindings.has(callee.text)) return true;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (callee.name.text !== 'parse' && callee.name.text !== 'safeParse') return false;
  const ownerExpression = unwrapExpression(callee.expression);
  const owner = expressionName(ownerExpression);
  if (owner?.toLowerCase().endsWith('schema') === true) return true;
  if (ts.isIdentifier(ownerExpression)) return imports.bindings.has(ownerExpression.text);
  return (
    ts.isPropertyAccessExpression(ownerExpression) &&
    ts.isIdentifier(ownerExpression.expression) &&
    imports.namespaces.has(ownerExpression.expression.text) &&
    ownerExpression.name.text.endsWith('Schema')
  );
}

function collectLocalFunctions(sourceFile: ts.SourceFile): Map<string, LocalFunction> {
  const functions = new Map<string, LocalFunction>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      functions.set(node.name.text, node);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      functions.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return functions;
}

function isAsyncFunction(node: LocalFunction): boolean {
  return node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true;
}

export function analyzeConversationVueReactiveBoundary(
  relativePath: string,
  content: string
): ConversationVueReactiveBoundaryViolation[] {
  const violations: ConversationVueReactiveBoundaryViolation[] = [];
  const lines = content.split(/\r?\n/u);

  const slices = relativePath.endsWith('.vue')
    ? extractVueScripts(content)
    : [{ content, lineOffset: 0 }];

  for (const slice of slices) {
    const sourceFile = ts.createSourceFile(
      relativePath,
      slice.content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const localFunctions = collectLocalFunctions(sourceFile);
    const schemaImports = collectSchemaImports(sourceFile);
    const reported = new Set<string>();

    const report = (node: ts.Node, rule: ConversationVueReactiveBoundaryRule): void => {
      const localLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
      const line = localLine + slice.lineOffset + 1;
      const key = `${rule}:${line}:${node.getStart(sourceFile)}`;
      if (reported.has(key)) return;
      reported.add(key);
      violations.push({
        rule,
        file: relativePath,
        line,
        preview: (lines[line - 1] ?? '').trim().slice(0, 160),
      });
    };

    const inspectedFunctions = new Set<LocalFunction>();
    const inspectReactiveNode = (node: ts.Node, enterFunctionBody = false): void => {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node)) &&
        (!enterFunctionBody || isAsyncFunction(node))
      ) {
        return;
      }
      if (ts.isIdentifier(node)) {
        const referencedFunction = localFunctions.get(node.text);
        if (referencedFunction && !inspectedFunctions.has(referencedFunction)) {
          inspectedFunctions.add(referencedFunction);
          inspectReactiveNode(referencedFunction, true);
        }
      }
      if (ts.isThrowStatement(node)) {
        report(node, 'CONV-VUE-02-reactive-throw');
      }
      if (ts.isCallExpression(node)) {
        if (isSchemaParseCall(node, schemaImports)) {
          report(node, 'CONV-VUE-01-schema-parse');
        }
        const calledName = expressionName(node.expression);
        const localFunction = calledName ? localFunctions.get(calledName) : undefined;
        if (localFunction && !inspectedFunctions.has(localFunction)) {
          inspectedFunctions.add(localFunction);
          inspectReactiveNode(localFunction, true);
        }
      }
      ts.forEachChild(node, child => inspectReactiveNode(child));
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (relativePath.endsWith('.vue') && isSchemaParseCall(node, schemaImports)) {
          report(node, 'CONV-VUE-01-schema-parse');
        }
        const reactiveApi = expressionName(node.expression);
        if (reactiveApi && REACTIVE_APIS.has(reactiveApi)) {
          const reactiveArgs =
            reactiveApi === 'watch' ? node.arguments.slice(0, 2) : node.arguments.slice(0, 1);
          for (const argument of reactiveArgs) inspectReactiveNode(argument, true);
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  return violations;
}

export function runConversationVueReactiveBoundaryGuard(): ConversationVueReactiveBoundaryViolation[] {
  const root = path.join(REPO_ROOT, SCAN_ROOT);
  return collectProductionReactiveFiles(root, []).flatMap(absolutePath => {
    const relativePath = path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
    return analyzeConversationVueReactiveBoundary(
      relativePath,
      fs.readFileSync(absolutePath, 'utf8')
    );
  });
}

function main(): void {
  const violations = runConversationVueReactiveBoundaryGuard();
  if (violations.length === 0) {
    console.log('conversation Vue/TS reactive boundary guard passed');
    return;
  }
  console.error('Conversation Vue/TS 响应式层重新引入了 parse/throw：');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line} [${violation.rule}] ${violation.preview}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
