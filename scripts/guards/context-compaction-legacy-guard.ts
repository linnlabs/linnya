/**
 * 自动上下文压缩旧机制零基线守卫。
 *
 * 旧 checkpoint 工具、step reset 与专用摘要模型已经成组删除。这里扫描正式
 * 生产源码，防止后来者重新引入第二条压缩链路或已经退役的 wire 字段。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = [
  'packages/linnkit/src',
  'packages/schemas/src',
  'packages/plugins',
  'src',
  'apps/renderer',
  'cloud/src',
  'cloud/admin/src',
] as const;
const SCANNABLE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs', '.ts', '.tsx', '.vue']);
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'docs',
  '__snapshots__',
  '__tests__',
  '__test-helpers__',
  'fixtures',
  'testkit',
]);
const TEST_FILE_PATTERN = /\.(test|spec)\.(js|ts|tsx)$/u;

export type ContextCompactionLegacyRule =
  | 'LEGACY-COMPACTION-01-step-reset'
  | 'LEGACY-COMPACTION-02-budget-warning'
  | 'LEGACY-COMPACTION-03-checkpoint-tool'
  | 'LEGACY-COMPACTION-04-summary-model-field'
  | 'LEGACY-COMPACTION-05-summary-model-purpose';

export interface ContextCompactionLegacyViolation {
  readonly rule: ContextCompactionLegacyRule;
  readonly token: string;
  readonly file: string;
  readonly line: number;
  readonly preview: string;
}

const LEGACY_PATTERNS: readonly {
  readonly rule: ContextCompactionLegacyRule;
  readonly token: string;
  readonly pattern: RegExp;
}[] = [
  ...['_checkpointStepReset', 'maxCheckpoints', 'absoluteMaxSteps', 'contextCheckpointToolName']
    .map(token => ({
      rule: 'LEGACY-COMPACTION-01-step-reset' as const,
      token,
      pattern: identifierPattern(token),
    })),
  ...['budget-warning', 'context_budget_warning'].map(token => ({
    rule: 'LEGACY-COMPACTION-02-budget-warning' as const,
    token,
    pattern: identifierPattern(token),
  })),
  ...['context_checkpoint', 'contextCheckpointTool'].map(token => ({
    rule: 'LEGACY-COMPACTION-03-checkpoint-tool' as const,
    token,
    pattern: identifierPattern(token),
  })),
  ...[
    'summary_model_id',
    'summaryModelId',
    'summary_prompt_version',
    'summaryPromptVersion',
    'summaryMaxOutputTokens',
  ].map(token => ({
    rule: 'LEGACY-COMPACTION-04-summary-model-field' as const,
    token,
    pattern: identifierPattern(token),
  })),
  ...['history_compression', 'PromptKeys.HISTORY_COMPRESSION', 'CheckpointSummarizationProvider', 'AISummaryGenerator'].map(token => ({
    rule: 'LEGACY-COMPACTION-05-summary-model-purpose' as const,
    token,
    pattern: identifierPattern(token),
  })),
];

function identifierPattern(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'u');
}

function collectProductionFiles(root: string, files: string[]): void {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectProductionFiles(absolute, files);
    } else if (
      SCANNABLE_EXTENSIONS.has(path.extname(entry.name))
      && !TEST_FILE_PATTERN.test(entry.name)
    ) {
      files.push(absolute);
    }
  }
}

export function analyzeContextCompactionLegacySource(
  relativePath: string,
  content: string,
): ContextCompactionLegacyViolation[] {
  const violations: ContextCompactionLegacyViolation[] = [];
  content.split(/\r?\n/u).forEach((line, index) => {
    for (const legacy of LEGACY_PATTERNS) {
      if (!legacy.pattern.test(line)) continue;
      violations.push({
        rule: legacy.rule,
        token: legacy.token,
        file: relativePath,
        line: index + 1,
        preview: line.trim().slice(0, 160),
      });
    }
  });
  return violations;
}

export function runContextCompactionLegacyGuard(): ContextCompactionLegacyViolation[] {
  const violations: ContextCompactionLegacyViolation[] = [];
  for (const root of SCAN_ROOTS) {
    const files: string[] = [];
    collectProductionFiles(path.join(REPO_ROOT, root), files);
    for (const absolute of files) {
      const relativePath = path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
      violations.push(...analyzeContextCompactionLegacySource(
        relativePath,
        fs.readFileSync(absolute, 'utf8'),
      ));
    }
  }
  return violations;
}

function main(): void {
  const violations = runContextCompactionLegacyGuard();
  if (violations.length === 0) {
    console.log('context compaction legacy guard passed');
    return;
  }
  console.error('自动上下文压缩旧机制重新进入生产源码：');
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line} [${violation.rule}] ${violation.token}`,
    );
    console.error(`    ${violation.preview}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
