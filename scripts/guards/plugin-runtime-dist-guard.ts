import fs from 'node:fs';
import path from 'node:path';

interface Violation {
  readonly file: string;
  readonly pluginId: string;
  readonly symbol: string;
  readonly line: number;
  readonly preview: string;
}

const repoRoot = process.cwd();
const scanRoots = [
  path.join(repoRoot, 'dist/main'),
  path.join(repoRoot, 'dist/renderer'),
];

const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.txt',
]);

const forbiddenMindmapBusinessSymbols = [
  'MindMapCreateNodeTool',
  'MindMapDocumentSchemaProvider',
  'MindMapDocumentService',
  'MindMapToolCards',
  'MindMapToolbar',
  'MindMapView',
  'MindmapPage',
  'buildMindMapNodeRefView',
  'mindmapAgentDefinitions',
  'mindmapDocumentTypeBackendHook',
  'mindmapPluginMigrations',
  'mindmapToolClasses',
] as const;

const forbiddenPluginBusinessSymbols = {
  mindmap: forbiddenMindmapBusinessSymbols,
  sheet: [
    'SheetClearRangeTool',
    'SheetClipboardService',
    'SheetDeleteTool',
    'SheetDocumentService',
    'SheetFillMissingTool',
    'SheetGetUsedRangeTool',
    'SheetInsertTool',
    'SheetMergeRangeTool',
    'SheetMoveRangeTool',
    'SheetNormalizeTableTool',
    'SheetPage',
    'SheetQuerySqliteTool',
    'SheetReadModelReplayer',
    'SheetSampleTool',
    'SheetUnmergeRangeTool',
    'SheetWorkbench',
    'sheetDocumentTypeBackendHook',
    'sheetPluginMigrations',
    'sheetToolManifest',
  ],
  slides: [
    'CanonicalBuilder',
    'CodegenPresentationService',
    'DeckAssembler',
    'DeckViewer',
    'FreeformCompiler',
    'InProcessSlidesEngineExecutionAdapter',
    'PatchCompiler',
    'PatchPlanBuilder',
    'PatchXmlEditor',
    'PptCoordinator',
    'PptPresentationQueryService',
    'PptxPackageSanitizer',
    'PptxReader',
    'PptxValidator',
    'PresentationDraftRepository',
    'PresentationRepository',
    'SlidesPage',
    'SlidesView',
    'StructuredCompiler',
    'TemplateManager',
    'slidesPluginMigrations',
    'slidesToolManifest',
  ],
  supplystrata: [
    'EditMapModelError',
    'OfficialDisclosureConnectorNotFoundError',
    'SourceRateLimiter',
    'SqliteDatabaseStore',
    'SupplystrataCanvas',
    'SupplystrataPage',
    'SupplystrataProposeDeckEdgesTool',
    'SupplystrataProposeDisclosureEdgesTool',
    'SupplystrataProposeWebEdgesTool',
    'SupplystrataStartResearchTool',
    'SupplystrataValidateMapDeckTool',
    'supplystrataDocumentTypeBackendHook',
    'supplystrataIngestion',
    'supplystrataPluginMigrations',
    'supplystrataToolClasses',
    'supplystrataToolManifest',
  ],
} as const satisfies Record<string, readonly string[]>;

function rel(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll('\\', '/');
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) {
    throw new Error(`构建产物目录不存在，请先运行构建: ${rel(dir)}`);
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    if (entry.isFile() && textExtensions.has(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }
}

function findLine(content: string, offset: number): { line: number; preview: string } {
  const before = content.slice(0, offset);
  const line = before.split(/\r?\n/).length;
  const lineStart = Math.max(content.lastIndexOf('\n', offset) + 1, 0);
  const lineEnd = content.indexOf('\n', offset);
  return {
    line,
    preview: content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim(),
  };
}

function collectViolations(): Violation[] {
  const files: string[] = [];
  for (const root of scanRoots) {
    walk(root, files);
  }

  const violations: Violation[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const [pluginId, symbols] of Object.entries(forbiddenPluginBusinessSymbols)) {
      for (const symbol of symbols) {
        const offset = content.indexOf(symbol);
        if (offset === -1) continue;
        const location = findLine(content, offset);
        violations.push({
          file: rel(file),
          pluginId,
          symbol,
          line: location.line,
          preview: location.preview,
        });
      }
    }
  }
  return violations;
}

function main(): void {
  const violations = collectViolations();
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `[PLUGIN-RUNTIME-DIST-01-no-official-plugin-business-code] ${violation.file}:${violation.line} ${violation.pluginId}:${violation.symbol} :: ${violation.preview}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log('plugin runtime dist guard passed');
}

main();
