import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

export type MarkdownDomainBoundaryRuleId =
  | 'MARKDOWN-BOUNDARY-01-workspace-no-deep-import'
  | 'MARKDOWN-BOUNDARY-02-generic-tools-use-host-contract'
  | 'MARKDOWN-BOUNDARY-03-tool-context-has-no-markdown-service'
  | 'MARKDOWN-BOUNDARY-04-no-workspace-markdown-tool-island'
  | 'MARKDOWN-BOUNDARY-05-no-generic-table-tool-island';

export interface MarkdownDomainBoundaryViolation {
  readonly ruleId: MarkdownDomainBoundaryRuleId;
  readonly file: string;
  readonly line: number;
  readonly importPath: string;
  readonly message: string;
}

const REPOSITORY_ROOT = process.cwd();
const PRODUCTION_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const GENERIC_WORKSPACE_TOOL_ROOTS = [
  'src/tools/workspace/list_files/',
  'src/tools/workspace/read_file/',
  'src/tools/workspace/grep/',
  'src/tools/workspace/edit_file/',
  'src/tools/workspace/write_file/',
] as const;

function normalize(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isProductionSource(filePath: string): boolean {
  const normalized = normalize(filePath);
  return PRODUCTION_EXTENSIONS.has(path.extname(normalized))
    && !normalized.includes('/__tests__/')
    && !normalized.includes('/fixtures/')
    && !/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(normalized);
}

function importedModules(filePath: string, source: string): ReadonlyArray<{
  readonly importPath: string;
  readonly line: number;
}> {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: Array<{ readonly importPath: string; readonly line: number }> = [];

  const record = (node: ts.Node, specifier: ts.Expression | undefined): void => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    imports.push({
      importPath: specifier.text,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node, node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node, node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      record(node, node.arguments[0]);
    } else if (ts.isImportTypeNode(node)) {
      record(
        node,
        ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function isMarkdownDomainImport(importPath: string): boolean {
  return normalize(importPath).includes('domains/markdown');
}

function isMarkdownDomainDeepImport(importPath: string): boolean {
  const normalized = normalize(importPath);
  const domainIndex = normalized.indexOf('domains/markdown');
  if (domainIndex < 0) return false;
  return normalized.slice(domainIndex + 'domains/markdown'.length).startsWith('/');
}

function isWorkspaceFeature(filePath: string): boolean {
  return normalize(filePath).startsWith('src/features/workspace/');
}

function isGenericWorkspaceTool(filePath: string): boolean {
  const normalized = normalize(filePath);
  return GENERIC_WORKSPACE_TOOL_ROOTS.some(root => normalized.startsWith(root));
}

export function analyzeMarkdownDomainBoundarySource(
  filePath: string,
  source: string,
): readonly MarkdownDomainBoundaryViolation[] {
  if (!isProductionSource(filePath)) return [];
  const violations: MarkdownDomainBoundaryViolation[] = [];
  if (normalize(filePath).startsWith('src/tools/workspace/markdown/')) {
    violations.push({
      ruleId: 'MARKDOWN-BOUNDARY-04-no-workspace-markdown-tool-island',
      file: filePath,
      line: 1,
      importPath: '(file location)',
      message: 'Markdown 专属工具属于 Markdown domain；Workspace 工具聚合只保留五件套。',
    });
  }
  if (normalize(filePath).startsWith('src/tools/table/')) {
    violations.push({
      ruleId: 'MARKDOWN-BOUNDARY-05-no-generic-table-tool-island',
      file: filePath,
      line: 1,
      importPath: '(file location)',
      message: 'write_to_table 属于 Markdown TableBlock 工作流；不得恢复无领域归属的通用 table 工具岛。',
    });
  }
  for (const imported of importedModules(filePath, source)) {
    if (isWorkspaceFeature(filePath) && isMarkdownDomainDeepImport(imported.importPath)) {
      violations.push({
        ruleId: 'MARKDOWN-BOUNDARY-01-workspace-no-deep-import',
        file: filePath,
        line: imported.line,
        importPath: imported.importPath,
        message: 'Workspace 只能依赖 Markdown domain 的公开入口，不能导入其 feature 或 SQLite 内部实现。',
      });
    }
    if (isGenericWorkspaceTool(filePath) && isMarkdownDomainImport(imported.importPath)) {
      violations.push({
        ruleId: 'MARKDOWN-BOUNDARY-02-generic-tools-use-host-contract',
        file: filePath,
        line: imported.line,
        importPath: imported.importPath,
        message: '五个通用 Workspace 工具只能经 Workspace/Host 文档合同工作，不能认识 Markdown 实现。',
      });
    }
    if (normalize(filePath) === 'src/tools/types.ts' && isMarkdownDomainImport(imported.importPath)) {
      violations.push({
        ruleId: 'MARKDOWN-BOUNDARY-03-tool-context-has-no-markdown-service',
        file: filePath,
        line: imported.line,
        importPath: imported.importPath,
        message: 'ToolContext 不得重新暴露 Markdown 具体 service；文档类型能力应由 Host provider 组合。',
      });
    }
  }
  return violations;
}

function collectFiles(root: string): readonly string[] {
  if (!fs.existsSync(root)) return [];
  if (fs.statSync(root).isFile()) return isProductionSource(root) ? [root] : [];
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (isProductionSource(target)) files.push(target);
    }
  };
  walk(root);
  return files;
}

export function collectMarkdownDomainBoundaryViolations(
  repositoryRoot = REPOSITORY_ROOT,
): readonly MarkdownDomainBoundaryViolation[] {
  const scanRoots = ['src/features/workspace', 'src/tools/workspace', 'src/tools/types.ts'];
  return scanRoots.flatMap(scanRoot => (
    collectFiles(path.join(repositoryRoot, scanRoot)).flatMap(absolutePath => {
      const relativePath = normalize(path.relative(repositoryRoot, absolutePath));
      return analyzeMarkdownDomainBoundarySource(
        relativePath,
        fs.readFileSync(absolutePath, 'utf8'),
      );
    })
  ));
}

function run(): void {
  const violations = collectMarkdownDomainBoundaryViolations();
  if (violations.length === 0) {
    process.stdout.write('[markdown-domain-boundary-guard] 通过：Markdown、Workspace 与通用工具边界无旁路。\n');
    return;
  }
  process.stderr.write('[markdown-domain-boundary-guard] 检测到 Markdown 领域边界旁路：\n');
  for (const violation of violations) {
    process.stderr.write(
      `- ${violation.file}:${violation.line} [${violation.ruleId}] ${violation.importPath}\n`
      + `  ${violation.message}\n`,
    );
  }
  process.exitCode = 1;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(path.resolve(entryPath)).href) run();
