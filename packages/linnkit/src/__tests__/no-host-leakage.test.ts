import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

const contextManagerTargets = [
  'packages/linnkit/src/context-manager/index.ts',
  'packages/linnkit/src/context-manager/shared',
  'packages/linnkit/src/context-manager/profiles/agent',
];

const contextManagerLegacyLiterals = [
  'document_fragment',
  'project_context',
  'document_context',
  'user_quote',
  'additional_context',
  '前置上下文',
  '后置上下文',
  '编辑器写作',
  '批注回复',
  '表格填充',
  '音频转录',
  '[任务完成]',
];

const linnkitProductionTargets = ['packages/linnkit/src'];

/**
 * 明确属于当前 host/product 的名称和富请求字段。
 *
 * 通用词（如 workspace、knowledge、review）不在列表中；它们可以用于解释一个任意 host。
 * 这里只阻止框架重新依赖具体 host 的产品注册项、插件名或富请求 DTO。
 */
const hostProductLiterals = [
  ['Linn', 'ya'].join(''),
  'Deep Research',
  'deep_research',
  'Slides',
  'SharedMemory',
  'TaskState',
  'taskstate',
  'KnowledgeBase',
  'mindmap',
  'deepSearch',
  'workspaceProject',
  'currentBlockContent',
  'documentFragment',
  'projectMetadata',
  'documentMetadata',
  'userQuote',
  'recentRejections',
  'intentKey',
  'behaviorSummary',
  'imageGenerationModelId',
  'ToolSchemaContext',
];

function collectSourceFiles(target: string): string[] {
  const absoluteTarget = path.join(repoRoot, target);
  if (!fs.existsSync(absoluteTarget)) {
    return [];
  }

  const stat = fs.statSync(absoluteTarget);
  if (stat.isFile()) {
    return isTypeScriptFile(absoluteTarget) ? [absoluteTarget] : [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(absoluteTarget, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const child = path.join(absoluteTarget, entry.name);
    if (entry.isDirectory()) {
      // 该门禁约束生产源码的业务边界；测试夹具需要保留历史标签样本来验证转换行为。
      if (entry.name === '__tests__') {
        continue;
      }
      files.push(...collectSourceFiles(path.relative(repoRoot, child)));
      continue;
    }

    if (entry.isFile() && isTypeScriptFile(child)) {
      files.push(child);
    }
  }
  return files;
}

function isTypeScriptFile(filePath: string): boolean {
  return filePath.endsWith('.ts')
    && !filePath.endsWith('.d.ts')
    && !filePath.endsWith('.test.ts')
    && !filePath.endsWith('.spec.ts')
    && !filePath.endsWith('.integration.test.ts');
}

function findLiteralViolations(
  targets: string[],
  literals: string[],
  options: { readonly caseInsensitive?: boolean } = {},
): string[] {
  const violations: string[] = [];

  for (const target of targets) {
    for (const file of collectSourceFiles(target)) {
      const content = fs.readFileSync(file, 'utf8');
      const searchableContent = options.caseInsensitive ? content.toLowerCase() : content;
      const relativeFile = path.relative(repoRoot, file);

      for (const literal of literals) {
        const searchableLiteral = options.caseInsensitive
          ? literal.toLowerCase()
          : literal;
        if (searchableContent.includes(searchableLiteral)) {
          violations.push(`${relativeFile} contains ${literal}`);
        }
      }
    }
  }

  return violations;
}

describe('linnkit no host leakage', () => {
  it('keeps shared and agent profile code free of host-facing legacy literals', () => {
    expect(findLiteralViolations(
      contextManagerTargets,
      contextManagerLegacyLiterals,
    )).toEqual([]);
  });

  it('keeps all production source free of host product names and rich request fields', () => {
    // 测试夹具会故意保存历史工具名来验证 replay；collectSourceFiles 明确排除它们。
    expect(findLiteralViolations(
      linnkitProductionTargets,
      hostProductLiterals,
      { caseInsensitive: true },
    )).toEqual([]);
  });
});
