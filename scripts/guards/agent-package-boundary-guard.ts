/**
 * Agent package boundary guard.
 *
 * 目标：
 * - 防止已删除的 `packages/linnkit` 和 `src/agent` 过渡目录回流
 * - 阻止宿主或其他模块恢复 Linnkit 源码 deep import
 * - 阻止 production runtime 拖入 vitest / linnkit/testkit
 * - 阻止已废弃的 `linnkit/*` bare import 回流，统一消费 `@linnlabs/linnkit`
 *
 * 实现要点：
 * - 真实 import 提取走 TypeScript Compiler API（`extractImportsFromSource`）：
 *   AST 天然区分注释、字符串字面量、模板字符串、JSDoc 例子里的"伪 import"，
 *   并精确区分静态 / 动态导入；老的"按行 regex 扫描 + 跳过注释续行"启发式
 *   已彻底移除。
 * - 规则集合（`FORBIDDEN_IMPORT_RULES` + `analyze*Rule`）统一基于
 *   `(importPath, isStatic)` 判定，不再依赖原始预览串。
 * - `analyzeLine()` 仍作为单元测试与 baseline 解析的兼容入口，但内部
 *   delegate 给同一份规则评估逻辑（`analyzeImport`），保证两条路径同源。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

import {
  analyzeImport,
  BASELINE_ELIGIBLE_RULE_IDS,
  ENFORCE_EMPTY_DEEP_IMPORT_BASELINE,
  FORBIDDEN_AGENT_DIRS,
  IGNORE_DIRS,
  isIgnoredGuardPath,
  isProductionSource,
  normalizeFilePath,
  rel,
  repoRoot,
  type AnalyzeImportOptions,
  type ExtractedImport,
  type Violation,
} from './agent-package-boundary-guard.rules';

export type { AnalyzeImportOptions, Violation } from './agent-package-boundary-guard.rules';

type CliOptions = {
  baselinePath: string;
  emitBaseline: boolean;
  allowNonEmptyBaseline: boolean;
  includeMindmapPackageRules: boolean;
  includeRuntimePluginPackageRules: boolean;
};

const defaultBaselinePath = path.join(repoRoot, '.baseline/agent-deep-import-baseline.txt');

function walk(dir: string, out: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const full = path.join(dir, entry.name);
    const relativePath = rel(full);
    if (isIgnoredGuardPath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walk(full, out);
      continue;
    }

    if (entry.isFile()) {
      if (isProductionSource(relativePath) || isSourceTextGuardFile(relativePath)) {
        out.push(full);
      }
    }
  }
}

/**
 * Extract import paths from a single preview line via regex.
 *
 * 仅用于：
 * 1. baseline 文件解析（baseline 行的 preview 字段是历史违规快照）
 * 2. `analyzeLine()` 单元测试 API 兼容层
 *
 * 真实生产扫描走 {@link extractImportsFromSource}（TS AST），不会经过本函数，
 * 因此本函数不需要承担识别"是否在注释/字符串字面量内"的责任。
 */
export function extractImportPath(preview: string): string | null {
  const staticMatch = preview.match(/\bfrom\s+['"]([^'"]+)['"]/);
  if (staticMatch?.[1]) {
    return staticMatch[1];
  }

  const dynamicMatch = preview.match(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/);
  if (dynamicMatch?.[1]) {
    return dynamicMatch[1];
  }

  return null;
}

function inferScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) return ts.ScriptKind.JS;
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

type SourceChunk = {
  content: string;
  lineOffset: number;
  scriptKind: ts.ScriptKind;
  virtualFilePath: string;
};

function extractVueScriptChunks(filePath: string, content: string): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  const scriptBlockPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptBlockPattern.exec(content)) !== null) {
    const fullMatch = match[0];
    const attrs = match[1] ?? '';
    const scriptContent = match[2] ?? '';
    const tagEndOffset = fullMatch.indexOf('>');
    if (tagEndOffset < 0) continue;

    const scriptContentStart = match.index + tagEndOffset + 1;
    const suffix = inferVueScriptKind(attrs) === ts.ScriptKind.JS ? 'js' : 'ts';
    chunks.push({
      content: scriptContent,
      lineOffset: countLinesBefore(content, scriptContentStart),
      scriptKind: inferVueScriptKind(attrs),
      virtualFilePath: `${filePath}.${chunks.length}.${suffix}`,
    });
  }

  return chunks;
}

/**
 * 用 TypeScript Compiler API 从源码中精确提取所有 import 站点。
 *
 * 覆盖：
 * - `import x from 'foo'` / `import { x } from 'foo'` / `import * as x from 'foo'` / `import 'foo'`
 * - `import type { x } from 'foo'`
 * - `export { x } from 'foo'` / `export * from 'foo'` / `export type { x } from 'foo'`
 * - `import('foo')` / `await import('foo')` 动态导入
 * - `import x = require('foo')`
 *
 * 自动忽略（这是用 AST 而不是 regex 的根本理由）：
 * - 行/块注释里出现的样例代码
 * - 字符串字面量、模板字符串里出现的"看起来像 import 的字符串"
 * - 错误语法导致的伪 token
 */
export function extractImportsFromSource(filePath: string, content: string): ExtractedImport[] {
  const originalLines = content.split(/\r?\n/);
  if (filePath.endsWith('.vue')) {
    return extractVueScriptChunks(filePath, content).flatMap((chunk) => (
      extractImportsFromSourceChunk(chunk.virtualFilePath, chunk.content, originalLines, chunk.lineOffset, chunk.scriptKind)
    ));
  }

  return extractImportsFromSourceChunk(filePath, content, originalLines, 0, inferScriptKind(filePath));
}

function extractImportsFromSourceChunk(
  filePath: string,
  content: string,
  originalLines: string[],
  lineOffset: number,
  scriptKind: ts.ScriptKind,
): ExtractedImport[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );

  const out: ExtractedImport[] = [];

  function pushAt(node: ts.Node, specifier: ts.Expression | undefined, isStatic: boolean): void {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    const lineIndex = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
    const originalLineIndex = lineOffset + lineIndex;
    out.push({
      importPath: specifier.text,
      line: originalLineIndex + 1,
      isStatic,
      preview: (originalLines[originalLineIndex] ?? '').trim(),
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      pushAt(node, node.moduleSpecifier, true);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      pushAt(node, node.moduleSpecifier, true);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length > 0
    ) {
      pushAt(node, node.arguments[0], false);
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
    ) {
      pushAt(node, node.moduleReference.expression, true);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return out;
}

/**
 * 单行 preview 的兼容入口。仅供单元测试与 baseline 解析使用——它们的输入
 * 永远是干净的"import 行字符串"，不需要对抗注释/字符串字面量等 hostile input。
 *
 * 生产路径走 {@link collectViolations} → {@link extractImportsFromSource}，
 * 完全绕开本函数，因此本函数无需做 block comment / string literal 识别。
 */
export function analyzeLine(
  filePath: string,
  line: number,
  preview: string,
  options: AnalyzeImportOptions = {},
): Violation[] {
  const normalizedFilePath = normalizeFilePath(filePath);
  if (!isProductionSource(normalizedFilePath) || isIgnoredGuardPath(normalizedFilePath)) {
    return [];
  }

  const trimmedPreview = preview.trim();
  if (!trimmedPreview) {
    return [];
  }

  const importPath = extractImportPath(trimmedPreview);
  if (importPath === null) {
    return [];
  }

  // 静态 vs 动态：preview 里出现 `import(` 视为动态导入。
  const isStatic = !/\bimport\s*\(/.test(trimmedPreview);

  return analyzeImport(normalizedFilePath, line, importPath, isStatic, trimmedPreview, options);
}

function collectViolations(options: AnalyzeImportOptions): Violation[] {
  const files: string[] = [];
  walk(repoRoot, files);

  const violations: Violation[] = [];
  for (const file of files) {
    const relativeFilePath = rel(file);
    if (isIgnoredGuardPath(relativeFilePath) || !isProductionSource(relativeFilePath)) {
      continue;
    }

    const content = fs.readFileSync(file, 'utf8');
    violations.push(...analyzeSourceText(relativeFilePath, content));

    const imports = extractImportsFromSource(relativeFilePath, content);
    for (const { importPath, line, isStatic, preview } of imports) {
      violations.push(...analyzeImport(relativeFilePath, line, importPath, isStatic, preview, options));
    }
  }

  return violations;
}

function officialPluginRootDirs(): string[] {
  const pluginsRoot = path.join(repoRoot, 'packages/plugins');
  if (!fs.existsSync(pluginsRoot)) {
    return [];
  }

  return fs.readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginsRoot, entry.name))
    .filter((pluginRoot) => fs.existsSync(path.join(pluginRoot, 'tsconfig.json')))
    .sort();
}

function isAllowedPluginHostTypesShim(relativeFilePath: string): boolean {
  return (
    /^packages\/plugins\/[^/]+\/host-types\/rendererEnv\.d\.ts$/.test(relativeFilePath)
    || relativeFilePath === 'packages/plugins/sheet/host-types/renderer/sheetEngine.d.ts'
  );
}

function collectPluginHostTypesShimViolations(): Violation[] {
  const violations: Violation[] = [];

  for (const pluginRoot of officialPluginRootDirs()) {
    const hostTypesRoot = path.join(pluginRoot, 'host-types');
    if (!fs.existsSync(hostTypesRoot)) {
      continue;
    }

    const files: string[] = [];
    walk(hostTypesRoot, files);
    for (const file of files) {
      const relativeFilePath = rel(file);
      if (isAllowedPluginHostTypesShim(relativeFilePath)) {
        continue;
      }

      violations.push(createSourceViolation(
        'PLUGIN-GUARD-17-no-plugin-host-types-mirror',
        relativeFilePath,
        1,
        'host-types may only contain environment shims; SDK mirrors must live in packages/plugin-host-contract.',
      ));
    }
  }

  const resurrectedMirrorFiles = [
    ...officialPluginRootDirs().map((pluginRoot) => path.join(pluginRoot, 'src/backend/hostImports.d.ts')),
    ...officialPluginRootDirs().map((pluginRoot) => path.join(pluginRoot, 'host-types/rendererHostImports.d.ts')),
  ];
  for (const file of resurrectedMirrorFiles) {
    if (!fs.existsSync(file)) {
      continue;
    }

    violations.push(createSourceViolation(
      'PLUGIN-GUARD-17-no-plugin-host-types-mirror',
      rel(file),
      1,
      'hostImports/rendererHostImports mirrors are removed; use packages/plugin-host-contract.',
    ));
  }

  return violations;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonRecord(filePath: string): Record<string, unknown> | null {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return isRecord(parsed) ? parsed : null;
}

function readTsconfigPaths(tsconfigPath: string): Record<string, unknown> {
  const config = readJsonRecord(tsconfigPath);
  if (config === null) {
    return {};
  }

  const compilerOptions = config.compilerOptions;
  if (!isRecord(compilerOptions)) {
    return {};
  }

  const paths = compilerOptions.paths;
  return isRecord(paths) ? paths : {};
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function pointsOnlyTo(value: unknown, expectedTarget: string): boolean {
  return isStringArray(value) && value.length === 1 && value[0] === expectedTarget;
}

function isForbiddenPluginTsconfigPathKey(pathKey: string): boolean {
  return (
    pathKey.startsWith('src/')
    || pathKey.startsWith('apps/')
    || pathKey === '@'
    || pathKey.startsWith('@/domains/')
    || pathKey.startsWith('@/shared/')
    || pathKey.startsWith('@tools/')
    || pathKey.startsWith('@features/')
  );
}

function isAllowedPluginTsconfigPathTarget(target: string): boolean {
  return (
    target.startsWith('packages/plugin-host-contract/')
    || target.startsWith('packages/text-measurement-core/')
    || target.startsWith('packages/plugins/')
    || target.startsWith('packages/schemas/')
    || target === 'src/plugin-sdk/*'
  );
}

function collectPluginTsconfigContractViolations(): Violation[] {
  const violations: Violation[] = [];

  for (const pluginRoot of officialPluginRootDirs()) {
    const tsconfigPath = path.join(pluginRoot, 'tsconfig.json');
    const relativeTsconfigPath = rel(tsconfigPath);
    const paths = readTsconfigPaths(tsconfigPath);

    const backendPath = paths['@plugin/backend/*'];
    if (!pointsOnlyTo(backendPath, 'packages/plugin-host-contract/backend/*.ts')) {
      violations.push(createSourceViolation(
        'PLUGIN-GUARD-18-plugin-tsconfig-uses-host-contract',
        relativeTsconfigPath,
        1,
        '@plugin/backend/* must point to packages/plugin-host-contract/backend/*.ts',
      ));
    }

    const rendererPath = paths['@plugin/renderer/*'];
    if (!pointsOnlyTo(rendererPath, 'packages/plugin-host-contract/renderer/*.ts')) {
      violations.push(createSourceViolation(
        'PLUGIN-GUARD-18-plugin-tsconfig-uses-host-contract',
        relativeTsconfigPath,
        1,
        '@plugin/renderer/* must point to packages/plugin-host-contract/renderer/*.ts',
      ));
    }

    const localizationPath = paths['@app/localization'];
    if (!pointsOnlyTo(localizationPath, 'packages/plugin-host-contract/renderer/localization.ts')) {
      violations.push(createSourceViolation(
        'PLUGIN-GUARD-18-plugin-tsconfig-uses-host-contract',
        relativeTsconfigPath,
        1,
        '@app/localization must point to packages/plugin-host-contract/renderer/localization.ts',
      ));
    }

    for (const [pathKey, targetValue] of Object.entries(paths)) {
      if (isForbiddenPluginTsconfigPathKey(pathKey)) {
        violations.push(createSourceViolation(
          'PLUGIN-GUARD-19-no-plugin-tsconfig-host-internal-path',
          relativeTsconfigPath,
          1,
          `plugin tsconfig must not map host-internal alias ${pathKey}`,
        ));
      }

      if (!isStringArray(targetValue)) {
        continue;
      }

      for (const target of targetValue) {
        if (isAllowedPluginTsconfigPathTarget(target)) {
          continue;
        }

        violations.push(createSourceViolation(
          'PLUGIN-GUARD-19-no-plugin-tsconfig-host-internal-path',
          relativeTsconfigPath,
          1,
          `plugin tsconfig target ${target} is not an allowed contract/package target`,
        ));
      }
    }
  }

  return violations;
}

export function collectPluginContractGuardViolations(): Violation[] {
  return [
    ...collectPluginHostTypesShimViolations(),
    ...collectPluginTsconfigContractViolations(),
  ];
}

function createSourceViolation(
  ruleId: string,
  file: string,
  line: number,
  preview: string,
  importPath: string | null = null,
): Violation {
  return {
    ruleId,
    file,
    line,
    preview,
    importPath,
  };
}

function isToolContextDerivationGuardFile(filePath: string): boolean {
  return filePath.startsWith('src/tools/')
    && filePath !== 'src/tools/workspace/shared/workspaceToolContext.ts';
}

function isIdentifierNamed(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

function isContextWorkspaceServiceAccess(node: ts.Node): boolean {
  return ts.isPropertyAccessExpression(node)
    && node.name.text === 'workspaceService'
    && isIdentifierNamed(node.expression, 'context');
}

function isNewWorkspaceServiceExpression(node: ts.Node): boolean {
  return ts.isNewExpression(node)
    && isIdentifierNamed(node.expression, 'WorkspaceService');
}

function sourcePreviewAt(content: string, line: number): string {
  return (content.split(/\r?\n/)[line - 1] ?? '').trim();
}

function isSourceTextGuardFile(filePath: string): boolean {
  return (
    filePath === 'apps/renderer/app/layout/styles/editor-shell.css'
    || filePath === 'apps/renderer/app/layout/styles/components/DocumentSurface.css'
    || filePath === 'apps/renderer/domains/conversation/styles/components/index.css'
    || filePath === 'apps/renderer/domains/conversation/ui/tools/workspace/WorkspaceDocumentViewCard.vue'
    || filePath === 'apps/renderer/domains/conversation/ui/shared/workspaceReferenceResolver.ts'
  );
}

const PLUGIN_DOCUMENT_PRESENTATION_MARKERS = [
  'for-mindmap',
  'for-sheet',
  'for-slides',
  'for-supplystrata',
  'document-surface--mindmap',
  'document-surface--sheet',
  'document-surface--slides',
  'document-surface--supplystrata',
] as const;

function sourceLineViolations(filePath: string, content: string): Violation[] {
  const lines = content.split(/\r?\n/);
  const violations: Violation[] = [];

  const push = (ruleId: string, lineIndex: number): void => {
    violations.push(createSourceViolation(
      ruleId,
      filePath,
      lineIndex + 1,
      lines[lineIndex]?.trim() ?? '',
    ));
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (
      filePath === 'apps/renderer/domains/conversation/styles/components/index.css'
      && /Presentation(?:Action|Creation|Inspect|Plan|TemplateList)Card\.css|PptPlanApprovalCard\.css/.test(line)
    ) {
      push('PLUGIN-GUARD-12-no-slides-tool-card-css-in-host-conversation', i);
    }

    if (
      filePath === 'apps/renderer/app/layout/AppLayout.vue'
      && /shellDocumentType\s*={2,3}\s*['"](?:mindmap|sheet|presentation|slides|supplystrata)['"]/.test(line)
    ) {
      push('PLUGIN-GUARD-13-no-plugin-type-branch-in-app-layout', i);
    }

    if (
      (
        filePath === 'apps/renderer/app/layout/styles/editor-shell.css'
        || filePath === 'apps/renderer/app/layout/styles/components/DocumentSurface.css'
      )
      && PLUGIN_DOCUMENT_PRESENTATION_MARKERS.some((marker) => line.includes(marker))
    ) {
      push('PLUGIN-GUARD-13-no-plugin-type-branch-in-app-layout', i);
    }

    if (
      (
        filePath === 'apps/renderer/domains/conversation/ui/message/components/markstream/ConversationReferenceNode.vue'
        || filePath === 'apps/renderer/domains/conversation/ui/tools/shared/WorkspaceRefLink.vue'
      )
      && (
        /getDocumentReferenceRuntimeHandler\(\s*['"]mindmap['"]\s*\)/.test(line)
        || /docTypeHint\s*={2,3}\s*['"]mindmap['"]/.test(line)
        || /return\s+['"]节点引用['"]/.test(line)
      )
    ) {
      push('PLUGIN-GUARD-14-no-mindmap-reference-label-in-host-conversation', i);
    }

    if (
      filePath === 'apps/renderer/domains/conversation/ui/shared/workspaceReferenceResolver.ts'
      && /resolveMindMapReferenceInDocument/.test(line)
    ) {
      push('PLUGIN-GUARD-15-no-mindmap-reference-resolver-wrapper', i);
    }

    if (
      filePath === 'apps/renderer/domains/conversation/ui/tools/workspace/WorkspaceDocumentViewCard.vue'
      && (
        /parseDocumentOutlineFromPlainBody/.test(line)
        || /\[#[^\]]+\]/.test(line)
        || /Root\)/.test(line)
        || /⟦/.test(line)
      )
    ) {
      push('PLUGIN-GUARD-16-no-outline-private-text-parsing-in-host-conversation', i);
    }
  }

  return violations;
}

function isOfficialPluginBackendContributionEntry(filePath: string): boolean {
  return /^packages\/plugins\/[^/]+\/src\/backend\/index\.ts$/.test(filePath);
}

function isOfficialPluginRendererEntry(filePath: string): boolean {
  return /^packages\/plugins\/[^/]+\/src\/renderer\/index\.ts$/.test(filePath);
}

type BackendPublicEntryGuard = {
  readonly rulePrefix: string;
  readonly backendImportPath: string;
  readonly publicEntryPath: string;
  readonly forbiddenPublicExports: ReadonlySet<string>;
  readonly forbiddenPublicExportPathFragments: readonly string[];
};

const BACKEND_PUBLIC_ENTRY_GUARDS: readonly BackendPublicEntryGuard[] = [
  {
    rulePrefix: 'MINDMAP-PKG',
    backendImportPath: '@plugin/mindmap/backend',
    publicEntryPath: 'packages/plugins/mindmap/src/backend/index.ts',
    forbiddenPublicExports: new Set([
      'MINDMAP_DOCUMENT_SCHEMAS',
      'MindMapDocumentService',
      'CreateMindMapParams',
      'UpdateMindMapParams',
      'MindMapData',
      'buildMindMapNodeRefView',
      'buildMindMapObservation',
      'MindMapNodeRefViewResult',
      'MindMapUiLimits',
      'registerMindMapDocumentHandlers',
      'mindmapToolClasses',
      'mindmapToolManifest',
      'mindmapToolNames',
      'MindmapBackendToolClass',
    ]),
    forbiddenPublicExportPathFragments: [
      'persistence/mindmap_document/schemas/',
      'persistence/mindmap_document/services/',
      'ipc/mindmap_document/',
      'tools/mindmap',
    ],
  },
  {
    rulePrefix: 'SHEET-PKG',
    backendImportPath: '@plugin/sheet/backend',
    publicEntryPath: 'packages/plugins/sheet/src/backend/index.ts',
    forbiddenPublicExports: new Set([
      'SheetDocumentService',
      'ADD_WORKSHEET_MERGE_COMMAND',
      'INSERT_COL_COMMAND',
      'INSERT_ROW_COMMAND',
      'MOVE_RANGE_COMMAND',
      'REMOVE_COL_COMMAND',
      'REMOVE_ROWS_COMMAND',
      'REMOVE_WORKSHEET_MERGE_COMMAND',
      'SET_RANGE_VALUES_COMMAND',
      'buildSheetWorkbookSnapshotForRead',
      'AiWritableSheetMutationCommandId',
      'AppendOpsParams',
      'SheetOpInput',
      'SheetOpRow',
      'SheetPersistenceEnvelope',
    ]),
    forbiddenPublicExportPathFragments: [
      'persistence/sheet_document/services/',
      'persistence/sheet_document/schemas/',
    ],
  },
  {
    rulePrefix: 'SUPPLYSTRATA-PKG',
    backendImportPath: '@plugin/supplystrata/backend',
    publicEntryPath: 'packages/plugins/supplystrata/src/backend/index.ts',
    forbiddenPublicExports: new Set([
      'SUPPLYSTRATA_SCHEMA',
      'SqliteDatabaseStore',
      'supplystrataDocumentParser',
      'supplystrataEntityResolver',
      'supplystrataRelationExtractor',
      'supplystrataSourceAdapters',
      'supplystrataSecEdgarAdapter',
      'supplystrataIngestion',
      'SupplystrataStartResearchTool',
      'supplystrataToolClasses',
      'supplystrataToolManifest',
      'registerSupplystrataIpcHandlers',
    ]),
    forbiddenPublicExportPathFragments: [
      'persistence/functions/sqliteDatabaseStore',
      'persistence/definitions/supplystrataSchema',
      'domain/',
      'orchestration/ingestion',
      'tools',
    ],
  },
];

function backendPublicEntryGuardForPublicEntry(filePath: string): BackendPublicEntryGuard | null {
  return BACKEND_PUBLIC_ENTRY_GUARDS.find((guard) => guard.publicEntryPath === filePath) ?? null;
}

function isForbiddenBackendPublicExport(node: ts.Node, guard: BackendPublicEntryGuard): boolean {
  if (!ts.isExportDeclaration(node)) {
    return false;
  }

  if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    const normalizedModulePath = normalizeFilePath(node.moduleSpecifier.text);
    if (guard.forbiddenPublicExportPathFragments.some((fragment) => normalizedModulePath.includes(fragment))) {
      return true;
    }
  }

  return node.exportClause !== undefined
    && ts.isNamedExports(node.exportClause)
    && node.exportClause.elements.some((element) => (
      guard.forbiddenPublicExports.has(element.propertyName?.text ?? element.name.text)
    ));
}

function isCssSideEffectImport(node: ts.Node): node is ts.ImportDeclaration & {
  moduleSpecifier: ts.StringLiteral;
} {
  return ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text.endsWith('.css');
}

function isForbiddenStaticAgentDefinitionsImport(node: ts.Node): boolean {
  if (!ts.isImportDeclaration(node)) {
    return false;
  }
  if (!ts.isStringLiteral(node.moduleSpecifier)) {
    return false;
  }
  const modulePath = node.moduleSpecifier.text;
  if (
    !modulePath.endsWith('/app-hosts/linnya/agent-registry/agents')
    && modulePath !== 'src/app-hosts/linnya/agent-registry/agents'
  ) {
    return false;
  }
  const namedBindings = node.importClause?.namedBindings;
  if (!namedBindings || !ts.isNamedImports(namedBindings)) {
    return false;
  }
  return namedBindings.elements.some((element) => (
    element.name.text === 'ALL_AGENT_DEFINITIONS'
    || element.name.text === 'ALL_AGENT_DEFINITIONS_FOR_TESTS'
  ));
}

/**
 * 需要 AST 语义而不只是 import 语句的源文件守卫。
 *
 * 中文说明：
 * - 宿主工具层禁止裸派生 ToolContext，避免丢插件 WeakMap 绑定；
 * - 官方插件 backend contribution 禁止继续使用 legacy IPC 双字段，避免
 *   白名单和真实 registrar 分裂漂移。
 */
export function analyzeSourceText(filePath: string, content: string): Violation[] {
  const normalizedFilePath = normalizeFilePath(filePath);
  if (
    (!isProductionSource(normalizedFilePath) && !isSourceTextGuardFile(normalizedFilePath))
    || isIgnoredGuardPath(normalizedFilePath)
  ) {
    return [];
  }

  const lineViolations = sourceLineViolations(normalizedFilePath, content);
  if (!isProductionSource(normalizedFilePath)) {
    return lineViolations;
  }

  const sourceFile = ts.createSourceFile(
    normalizedFilePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    inferScriptKind(normalizedFilePath),
  );
  const violations: Violation[] = [...lineViolations];

  function lineOf(node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function visit(node: ts.Node): void {
    if (
      isToolContextDerivationGuardFile(normalizedFilePath)
      && ts.isSpreadAssignment(node)
      && isIdentifierNamed(node.expression, 'context')
    ) {
      const line = lineOf(node);
      violations.push(createSourceViolation(
        'PLUGIN-GUARD-03-no-naked-toolcontext-spread',
        normalizedFilePath,
        line,
        sourcePreviewAt(content, line),
      ));
    }

    if (
      isToolContextDerivationGuardFile(normalizedFilePath)
      && (
        ts.isBinaryExpression(node)
        && (
          node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
          || node.operatorToken.kind === ts.SyntaxKind.BarBarToken
        )
        && isContextWorkspaceServiceAccess(node.left)
        && isNewWorkspaceServiceExpression(node.right)
      )
    ) {
      const line = lineOf(node);
      violations.push(createSourceViolation(
        'PLUGIN-GUARD-04-no-workspace-service-fallback-in-tools',
        normalizedFilePath,
        line,
        sourcePreviewAt(content, line),
      ));
    }

    if (
      isOfficialPluginBackendContributionEntry(normalizedFilePath)
      && ts.isPropertyAssignment(node)
      && ts.isIdentifier(node.name)
      && (node.name.text === 'ipcChannels' || node.name.text === 'ipcRegistrars')
    ) {
      const line = lineOf(node);
      violations.push(createSourceViolation(
        'PLUGIN-GUARD-05-no-legacy-ipc-contribution-fields',
        normalizedFilePath,
        line,
        sourcePreviewAt(content, line),
      ));
    }

    if (
      isOfficialPluginBackendContributionEntry(normalizedFilePath)
      && ts.isPropertyAssignment(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'schemaProviders'
    ) {
      const line = lineOf(node);
      violations.push(createSourceViolation(
        'PLUGIN-GUARD-06-no-plugin-schema-providers',
        normalizedFilePath,
        line,
        sourcePreviewAt(content, line),
      ));
    }

    if (isForbiddenStaticAgentDefinitionsImport(node)) {
      const line = lineOf(node);
      violations.push(createSourceViolation(
        'PLUGIN-GUARD-07-no-static-agent-definition-snapshot-in-production',
        normalizedFilePath,
        line,
        sourcePreviewAt(content, line),
      ));
    }

    const backendPublicEntryGuard = backendPublicEntryGuardForPublicEntry(normalizedFilePath);
    if (backendPublicEntryGuard !== null && isForbiddenBackendPublicExport(node, backendPublicEntryGuard)) {
      const line = lineOf(node);
      violations.push(createSourceViolation(
        `${backendPublicEntryGuard.rulePrefix}-08-no-public-backend-persistence-export`,
        normalizedFilePath,
        line,
        sourcePreviewAt(content, line),
        backendPublicEntryGuard.backendImportPath,
      ));
    }

    if (isOfficialPluginRendererEntry(normalizedFilePath) && isCssSideEffectImport(node)) {
      const line = lineOf(node);
      violations.push(createSourceViolation(
        'PLUGIN-GUARD-11-no-plugin-renderer-css-side-effect-import',
        normalizedFilePath,
        line,
        sourcePreviewAt(content, line),
        node.moduleSpecifier.text,
      ));
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function baselineKey(file: string, importPath: string): string {
  return `${normalizeFilePath(file)}::${importPath}`;
}

export function parseBaselineEntries(lines: string[]): Set<string> {
  const entries = new Set<string>();

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const baselineMatch = trimmedLine.match(/^(.*?):\d+:(.*)$/);
    if (!baselineMatch?.[1] || !baselineMatch[2]) {
      continue;
    }

    const preview = baselineMatch[2].trim();
    const importPath = extractImportPath(preview);
    if (importPath === null) {
      continue;
    }

    entries.add(baselineKey(baselineMatch[1], importPath));
  }

  return entries;
}

function readBaselineEntries(baselinePath: string): Set<string> {
  if (!fs.existsSync(baselinePath)) {
    return new Set<string>();
  }

  const lines = fs.readFileSync(baselinePath, 'utf8').split(/\r?\n/);
  return parseBaselineEntries(lines);
}

export function validateDeepImportBaselineState(
  baselineEntries: Set<string>,
  baselinePath: string,
  enforceEmptyBaseline = ENFORCE_EMPTY_DEEP_IMPORT_BASELINE,
): string | null {
  if (!enforceEmptyBaseline || baselineEntries.size === 0) {
    return null;
  }

  return [
    '[AGENT-GUARD-BASELINE-NOT-EMPTY]',
    `${rel(baselinePath)} still contains ${baselineEntries.size} reverse-import baseline entr${baselineEntries.size === 1 ? 'y' : 'ies'}.`,
    'D-2 PR-J has switched the guard to final enforce mode: clear the file instead of freezing residual violations.',
  ].join(' ');
}

export function partitionBaselineViolations(
  violations: Violation[],
  baselineEntries: Set<string>,
): { baselined: Violation[]; blocking: Violation[] } {
  const baselined: Violation[] = [];
  const blocking: Violation[] = [];

  for (const violation of violations) {
    if (violation.importPath === null) {
      blocking.push(violation);
      continue;
    }

    const key = baselineKey(violation.file, violation.importPath);
    if (baselineEntries.has(key)) {
      baselined.push(violation);
      continue;
    }

    blocking.push(violation);
  }

  return { baselined, blocking };
}

function formatViolation(violation: Violation): string {
  return `[${violation.ruleId}] ${violation.file}:${violation.line} ${violation.preview}`;
}

function formatBaselineLine(violation: Violation): string {
  return `${violation.file}:${violation.line}:${violation.preview}`;
}

function parseCliOptions(args: string[]): CliOptions {
  let baselinePath = defaultBaselinePath;
  let emitBaseline = false;
  let allowNonEmptyBaseline = false;
  let includeMindmapPackageRules = false;
  let includeRuntimePluginPackageRules = true;

  for (const arg of args) {
    if (arg === '--emit-baseline') {
      emitBaseline = true;
      continue;
    }

    if (arg === '--allow-non-empty-baseline') {
      allowNonEmptyBaseline = true;
      continue;
    }

    if (arg === '--include-mindmap-package-rules') {
      includeMindmapPackageRules = true;
      includeRuntimePluginPackageRules = true;
      continue;
    }

    if (arg === '--skip-runtime-plugin-package-rules') {
      includeRuntimePluginPackageRules = false;
      continue;
    }

    if (arg.startsWith('--baseline=')) {
      const candidatePath = arg.slice('--baseline='.length).trim();
      if (candidatePath.length > 0) {
        baselinePath = path.resolve(repoRoot, candidatePath);
      }
    }
  }

  return {
    baselinePath,
    emitBaseline,
    allowNonEmptyBaseline,
    includeMindmapPackageRules,
    includeRuntimePluginPackageRules,
  };
}

export function main(args: string[] = process.argv.slice(2)): void {
  const options = parseCliOptions(args);
  const violations = [
    ...collectViolations({
      includeRuntimePluginPackageRules: options.includeRuntimePluginPackageRules,
      includeMindmapPackageRules: options.includeMindmapPackageRules,
    }),
    ...collectPluginContractGuardViolations(),
  ];

  if (options.emitBaseline) {
    const baselineLines = violations
      .filter((violation) => BASELINE_ELIGIBLE_RULE_IDS.has(violation.ruleId))
      .map(formatBaselineLine)
      .sort();
    for (const line of baselineLines) {
      console.log(line);
    }
    return;
  }

  let hasError = false;

  for (const dir of FORBIDDEN_AGENT_DIRS) {
    if (fs.existsSync(path.join(repoRoot, dir))) {
      hasError = true;
      console.error(`[AGENT-GUARD-00-legacy-dir] forbidden directory exists: ${dir}`);
    }
  }

  const baselineEntries = readBaselineEntries(options.baselinePath);
  const baselineStateError = validateDeepImportBaselineState(
    baselineEntries,
    options.baselinePath,
    !options.allowNonEmptyBaseline,
  );
  if (baselineStateError !== null) {
    hasError = true;
    console.error(baselineStateError);
  }
  const legacyViolations = violations.filter(
    (violation) => !BASELINE_ELIGIBLE_RULE_IDS.has(violation.ruleId),
  );
  const baselineEligibleViolations = violations.filter((violation) =>
    BASELINE_ELIGIBLE_RULE_IDS.has(violation.ruleId),
  );
  const partitioned = partitionBaselineViolations(baselineEligibleViolations, baselineEntries);

  for (const violation of legacyViolations) {
    hasError = true;
    console.error(formatViolation(violation));
  }

  for (const violation of partitioned.blocking) {
    hasError = true;
    console.error(formatViolation(violation));
  }

  if (hasError) {
    process.exitCode = 1;
    return;
  }

  if (partitioned.baselined.length > 0) {
    console.warn(
      `[BASELINED] ${partitioned.baselined.length} existing violations are frozen by ${rel(options.baselinePath)}`,
    );
  }

  console.log('agent package boundary guard passed');
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main();
}
