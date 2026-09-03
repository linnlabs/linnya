import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const conversationRoot = join(process.cwd(), 'apps/renderer/domains/conversation');
const productionExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.css', '.scss']);
const tableImplementationDependency = /(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"][^'"]*(?:@tiptap\/pm\/tables|editor\/blocks\/TableBlock)/;
const tableOwnerDependency = /(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"][^'"]*(?:editor\/features\/table-ai-mode|app\/workflows\/table-fill)/;
const tableBusinessSemantic = /(?:write[-_]to[-_]table|table[-_]fill|table[-_]?ai|table[-_]?assistant|table[-_]?mode|isTableMode|has[-_]?table[-_]?context|column[-_]?reference|conversation\.(?:tool\.table|flow\.tableFill|tableContext|card\.tableFillStep))/i;
const legacyTableIntegration = /(?:AiAssistantTableContext|AiAssistantTableIntegration|TableBlockAiIntegration|tableAiUiBridge|columnReferenceService|aiIntegrationEventBus|useTableAssistantStore|tableAssistantStore|store\/tableAssistant)/i;

function isTestFile(filePath: string): boolean {
  return /\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/.test(filePath)
    || filePath.includes('/__tests__/');
}

function readProductionFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...readProductionFiles(path));
    } else if (productionExtensions.has(extname(entry.name)) && !isTestFile(path)) {
      files.push(path);
    }
  }
  return files;
}

describe('conversation Table AI boundary', () => {
  it('禁止 conversation 导入 ProseMirror table 模块或 TableBlock 内部实现', () => {
    const offenders = readProductionFiles(conversationRoot)
      .filter((filePath) => tableImplementationDependency.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => relative(conversationRoot, filePath).replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });

  it('禁止恢复 conversation 所有的 table store 和 context 类型', () => {
    const offenders = readProductionFiles(conversationRoot)
      .filter((filePath) => legacyTableIntegration.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => relative(conversationRoot, filePath).replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });

  it('禁止 conversation 重新依赖 editor table mode 或 app table-fill workflow', () => {
    const offenders = readProductionFiles(conversationRoot)
      .filter((filePath) => tableOwnerDependency.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => relative(conversationRoot, filePath).replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });

  it('禁止 conversation 生产实现持有 table-fill 业务语义', () => {
    const offenders = readProductionFiles(conversationRoot)
      .filter((filePath) => tableBusinessSemantic.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => relative(conversationRoot, filePath).replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });

  it('边界依赖检查覆盖静态、side-effect、动态 import 与 require', () => {
    expect(tableOwnerDependency.test(
      "import type { Mode } from '@/domains/editor/features/table-ai-mode';",
    )).toBe(true);
    expect(tableOwnerDependency.test(
      "import '@/app/workflows/table-fill/setup';",
    )).toBe(true);
    expect(tableOwnerDependency.test(
      "const feature = await import('@/domains/editor/features/table-ai-mode');",
    )).toBe(true);
    expect(tableImplementationDependency.test(
      "const table = require('@/domains/editor/blocks/TableBlock/runtime');",
    )).toBe(true);
    expect(tableImplementationDependency.test(
      "import { TableMap } from '@tiptap/pm/tables';",
    )).toBe(true);
    expect(tableImplementationDependency.test(
      "import { PluginKey } from '@tiptap/pm/state';",
    )).toBe(false);
    expect(legacyTableIntegration.test('const bridge = tableAiUiBridge;')).toBe(true);
    expect(legacyTableIntegration.test('new AiAssistantTableIntegration()')).toBe(true);
  });
});
