/**
 * 已迁移工具卡门禁。
 *
 * 清单默认只允许随迁移增长；产品正式退役时必须与注册、组件、测试和 baseline 同切片删除。
 * 清单内卡片必须只接收 admission 后的 presentation，不得重新读取 raw args/result，
 * 也不得把 schema parse 或业务 throw 搬回 Vue reactive 层。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const REPO_ROOT = process.cwd();
const BASELINE_PATH = '.baseline/conversation-tool-presentation-cards.txt';
const HEADER_ONLY_BASELINE_PATH = '.baseline/conversation-tool-presentation-header-only.txt';
const BASELINE_HEADER = [
  '# Conversation presentation-only tool cards (INV-56)',
  '# 默认只允许新增；产品正式退役时必须与注册、组件和测试在同一切片删除。',
];
const HEADER_ONLY_BASELINE_HEADER = [
  '# Conversation presentation-only header registrations (INV-56)',
  '# 只允许新增。进入清单的 header-only 工具必须使用 projector，禁止恢复 raw title resolver。',
];

export const MIGRATED_TOOL_CARD_PATHS = [
  'apps/renderer/domains/conversation/ui/tools/questionnaire/QuestionnaireCard.vue',
  'apps/renderer/domains/conversation/ui/tools/taskstate/TaskStateCard.vue',
  'apps/renderer/domains/conversation/ui/tools/todo/AgentTodoCard.vue',
  'apps/renderer/domains/conversation/ui/tools/tool_output/ToolOutputReadCard.vue',
  'apps/renderer/domains/conversation/ui/tools/webread/WebReadCard.vue',
  'apps/renderer/domains/conversation/ui/tools/websearch/WebSearchCard.vue',
  'apps/renderer/domains/conversation/ui/tools/workspace/WorkspaceDocumentViewCard.vue',
  'apps/renderer/domains/conversation/ui/tools/sharedmemory/SharedMemoryDocReadCard.vue',
  'apps/renderer/domains/conversation/ui/tools/sharedmemory/SharedMemoryDocListCard.vue',
  'apps/renderer/domains/conversation/ui/tools/sharedmemory/SharedMemoryDocWriteCard.vue',
  'apps/renderer/domains/conversation/ui/tools/image/ImageGenerationCard.vue',
  'apps/renderer/domains/conversation/ui/tools/image-read/ImageReadCard.vue',
  'apps/renderer/domains/conversation/ui/tools/knowledge/DocumentContentCard.vue',
  'apps/renderer/domains/conversation/ui/tools/knowledge/DocumentListCard.vue',
  'apps/renderer/domains/conversation/ui/tools/knowledgebasesearchcard/KnowledgeSearchCard.vue',
  'apps/renderer/domains/conversation/ui/tools/skill/SkillLearnedCard.vue',
  'apps/renderer/domains/conversation/features/subrun-card/ui/SubrunCard.vue',
  'apps/renderer/domains/conversation/features/subrun-card/ui/SubrunProgressCard.vue',
  'apps/renderer/domains/conversation/features/subrun-collection/ui/SubrunBatchCollection.vue',
] as const;

interface MigratedHeaderOnlyToolConfig {
  readonly file: string;
  readonly exportName: string;
  readonly toolName: string;
}

export const MIGRATED_HEADER_ONLY_TOOL_CONFIGS: readonly MigratedHeaderOnlyToolConfig[] = [
  {
    file: 'apps/renderer/domains/conversation/ui/tools/configs/common.ts',
    exportName: 'commonToolConfigs',
    toolName: 'grep',
  },
  {
    file: 'apps/renderer/domains/conversation/ui/tools/configs/common.ts',
    exportName: 'commonToolConfigs',
    toolName: 'list_files',
  },
  {
    file: 'apps/renderer/domains/conversation/ui/tools/configs/workspace.ts',
    exportName: 'workspaceReadToolConfigs',
    toolName: 'workspace_read_file',
  },
  {
    file: 'apps/renderer/domains/conversation/ui/tools/configs/common.ts',
    exportName: 'commonToolConfigs',
    toolName: 'write_file',
  },
  {
    file: 'apps/renderer/domains/conversation/ui/tools/configs/common.ts',
    exportName: 'commonToolConfigs',
    toolName: 'edit_file',
  },
  {
    file: 'apps/renderer/domains/conversation/ui/tools/configs/common.ts',
    exportName: 'commonToolConfigs',
    toolName: 'assemble_documents',
  },
  {
    file: 'apps/renderer/domains/conversation/ui/tools/configs/common.ts',
    exportName: 'commonToolConfigs',
    toolName: 'assemble_evidence',
  },
  {
    file: 'apps/renderer/domains/conversation/ui/tools/configs/common.ts',
    exportName: 'commonToolConfigs',
    toolName: 'evidence_resolve',
  },
];

export type ToolPresentationMigrationRule =
  | 'missing-presentation-prop'
  | 'raw-prop-declaration'
  | 'raw-prop-read'
  | 'schema-parse'
  | 'throw'
  | 'missing-presentation-config'
  | 'legacy-title-config';

export interface ToolPresentationMigrationViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: ToolPresentationMigrationRule;
}

export interface ToolPresentationMigrationBaselineDiff {
  /** 已进入 baseline 却从迁移清单消失的卡片；这是禁止的回退。 */
  readonly removed: readonly string[];
  /** 新迁移完成、尚未写入 baseline 的卡片。 */
  readonly added: readonly string[];
}

interface ScriptSlice {
  readonly content: string;
  readonly lineOffset: number;
}

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

function propertyNameText(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

export function analyzeMigratedToolCard(
  relativePath: string,
  content: string,
): ToolPresentationMigrationViolation[] {
  const violations: ToolPresentationMigrationViolation[] = [];
  let hasPresentationProp = false;

  for (const slice of extractVueScripts(content)) {
    const sourceFile = ts.createSourceFile(
      relativePath,
      slice.content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const report = (node: ts.Node, rule: ToolPresentationMigrationRule): void => {
      const localLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
      violations.push({ file: relativePath, line: localLine + slice.lineOffset + 1, rule });
    };

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'defineProps'
      ) {
        const propsType = node.typeArguments?.[0];
        if (propsType && ts.isTypeLiteralNode(propsType)) {
          for (const member of propsType.members) {
            if (!ts.isPropertySignature(member)) continue;
            const name = propertyNameText(member.name);
            if (name === 'presentation') hasPresentationProp = true;
            if (name === 'args' || name === 'result') report(member, 'raw-prop-declaration');
          }
        }
      }

      if (
        ts.isPropertyAccessExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'props'
        && (node.name.text === 'args' || node.name.text === 'result')
      ) {
        report(node, 'raw-prop-read');
      }

      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && (node.expression.name.text === 'parse' || node.expression.name.text === 'safeParse')
      ) {
        report(node, 'schema-parse');
      }

      if (ts.isThrowStatement(node)) report(node, 'throw');
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  if (!hasPresentationProp) {
    violations.push({ file: relativePath, line: 1, rule: 'missing-presentation-prop' });
  }
  return violations;
}

export function runConversationToolPresentationMigrationGuard(): ToolPresentationMigrationViolation[] {
  const cardViolations = MIGRATED_TOOL_CARD_PATHS.flatMap((relativePath) => {
    const absolutePath = path.join(REPO_ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return [{ file: relativePath, line: 1, rule: 'missing-presentation-prop' as const }];
    }
    return analyzeMigratedToolCard(relativePath, fs.readFileSync(absolutePath, 'utf8'));
  });
  const configViolations = MIGRATED_HEADER_ONLY_TOOL_CONFIGS.flatMap((target) => {
    const absolutePath = path.join(REPO_ROOT, target.file);
    if (!fs.existsSync(absolutePath)) {
      return [{
        file: target.file,
        line: 1,
        rule: 'missing-presentation-config' as const,
      }];
    }
    return analyzeMigratedHeaderOnlyToolConfig(target, fs.readFileSync(absolutePath, 'utf8'));
  });
  return [...cardViolations, ...configViolations];
}

export function analyzeMigratedHeaderOnlyToolConfig(
  target: MigratedHeaderOnlyToolConfig,
  content: string,
): ToolPresentationMigrationViolation[] {
  const sourceFile = ts.createSourceFile(
    target.file,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let registry: ts.ObjectLiteralExpression | null = null;

  const findRegistry = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === target.exportName
      && node.initializer
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (ts.isObjectLiteralExpression(initializer)) registry = initializer;
    }
    ts.forEachChild(node, findRegistry);
  };
  ts.forEachChild(sourceFile, findRegistry);

  const registryObject = registry as ts.ObjectLiteralExpression | null;
  const entry = registryObject?.properties.find((property) => (
    ts.isPropertyAssignment(property) && propertyNameText(property.name) === target.toolName
  ));
  if (!entry || !ts.isPropertyAssignment(entry)) {
    return [{ file: target.file, line: 1, rule: 'missing-presentation-config' }];
  }

  const entryInitializer = unwrapExpression(entry.initializer);
  if (!ts.isObjectLiteralExpression(entryInitializer)) {
    const line = sourceFile.getLineAndCharacterOfPosition(entry.getStart(sourceFile)).line + 1;
    return [{ file: target.file, line, rule: 'missing-presentation-config' }];
  }

  const properties = new Map(
    entryInitializer.properties.map(property => [propertyNameText(property.name), property]),
  );
  const violations: ToolPresentationMigrationViolation[] = [];
  if (!properties.has('presentation')) {
    const line = sourceFile.getLineAndCharacterOfPosition(entry.getStart(sourceFile)).line + 1;
    violations.push({ file: target.file, line, rule: 'missing-presentation-config' });
  }
  const title = properties.get('title');
  if (title) {
    const line = sourceFile.getLineAndCharacterOfPosition(title.getStart(sourceFile)).line + 1;
    violations.push({ file: target.file, line, rule: 'legacy-title-config' });
  }
  return violations;
}

export function parseToolPresentationMigrationBaseline(content: string): string[] {
  const paths = content
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
  const duplicates = paths.filter((file, index) => paths.indexOf(file) !== index);
  if (duplicates.length > 0) {
    throw new Error(`presentation baseline 存在重复路径：${[...new Set(duplicates)].join(', ')}`);
  }
  return paths.sort();
}

export function compareToolPresentationMigrationBaseline(
  current: readonly string[],
  baseline: readonly string[],
): ToolPresentationMigrationBaselineDiff {
  const currentSet = new Set(current);
  const baselineSet = new Set(baseline);
  return {
    removed: [...baselineSet].filter(file => !currentSet.has(file)).sort(),
    added: [...currentSet].filter(file => !baselineSet.has(file)).sort(),
  };
}

export function runToolPresentationMigrationBaselineRatchet(): ToolPresentationMigrationBaselineDiff {
  const baseline = parseToolPresentationMigrationBaseline(
    fs.readFileSync(path.join(REPO_ROOT, BASELINE_PATH), 'utf8'),
  );
  return compareToolPresentationMigrationBaseline(MIGRATED_TOOL_CARD_PATHS, baseline);
}

function headerOnlyBaselineEntries(): string[] {
  return MIGRATED_HEADER_ONLY_TOOL_CONFIGS.map(
    target => `${target.file}#${target.exportName}.${target.toolName}`,
  ).sort();
}

export function runHeaderOnlyToolPresentationBaselineRatchet(): ToolPresentationMigrationBaselineDiff {
  const baseline = parseToolPresentationMigrationBaseline(
    fs.readFileSync(path.join(REPO_ROOT, HEADER_ONLY_BASELINE_PATH), 'utf8'),
  );
  return compareToolPresentationMigrationBaseline(headerOnlyBaselineEntries(), baseline);
}

function writeBaseline(paths: readonly string[]): void {
  fs.writeFileSync(
    path.join(REPO_ROOT, BASELINE_PATH),
    `${[...BASELINE_HEADER, ...[...paths].sort()].join('\n')}\n`,
  );
}

function writeHeaderOnlyBaseline(paths: readonly string[]): void {
  fs.writeFileSync(
    path.join(REPO_ROOT, HEADER_ONLY_BASELINE_PATH),
    `${[...HEADER_ONLY_BASELINE_HEADER, ...[...paths].sort()].join('\n')}\n`,
  );
}

function stageBaseline(): void {
  const result = spawnSync('git', ['add', '--', BASELINE_PATH, HEADER_ONLY_BASELINE_PATH], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`presentation baseline 已扩展，但 git add 失败：${result.stderr || result.stdout}`);
  }
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const shouldUpdate = args.has('--update-baseline');
  const shouldStage = args.has('--stage-baseline');
  const violations = runConversationToolPresentationMigrationGuard();
  if (violations.length > 0) {
    console.error('已迁移工具卡重新引入了 raw payload 或 reactive failure：');
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line} [${violation.rule}]`);
    }
    process.exitCode = 1;
    return;
  }

  const baselineDiff = runToolPresentationMigrationBaselineRatchet();
  const headerOnlyBaselineDiff = runHeaderOnlyToolPresentationBaselineRatchet();
  if (baselineDiff.removed.length > 0) {
    console.error('已迁移工具卡不得从 presentation-only baseline 移除：');
    for (const file of baselineDiff.removed) console.error(`  - ${file}`);
    process.exitCode = 1;
    return;
  }

  if (headerOnlyBaselineDiff.removed.length > 0) {
    console.error('已迁移 header-only 工具不得从 presentation-only baseline 移除：');
    for (const entry of headerOnlyBaselineDiff.removed) console.error(`  - ${entry}`);
    process.exitCode = 1;
    return;
  }

  if (baselineDiff.added.length === 0 && headerOnlyBaselineDiff.added.length === 0) {
    console.log('conversation tool presentation migration guard passed');
    return;
  }

  if (!shouldUpdate) {
    console.error('发现新迁移完成的工具卡，请扩展 presentation-only baseline：');
    for (const file of baselineDiff.added) console.error(`  + ${file}`);
    for (const entry of headerOnlyBaselineDiff.added) console.error(`  + ${entry}`);
    console.error('\n请运行 pnpm run guard:conversation-tool-presentation:update。');
    process.exitCode = 1;
    return;
  }

  writeBaseline(MIGRATED_TOOL_CARD_PATHS);
  writeHeaderOnlyBaseline(headerOnlyBaselineEntries());
  if (shouldStage) stageBaseline();
  console.log(
    `conversation tool presentation baseline 新增 ${baselineDiff.added.length} 张卡片、${headerOnlyBaselineDiff.added.length} 个 header-only 注册项`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
