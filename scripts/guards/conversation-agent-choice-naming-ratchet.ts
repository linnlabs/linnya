/**
 * Conversation agent 选择旧 workflow 命名棘轮（INV-55）。
 *
 * 旧表面允许在正名迁移中减少，但不能新增。这里不全仓禁用 workflow：
 * 未来真正可注册、可配置的显式工作流产品仍可使用这个准确的业务词。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = [
  'apps/renderer',
  'packages/plugin-host-contract',
  'packages/plugins',
] as const;
const BASELINE_PATH = '.baseline/conversation-agent-choice-workflow-names.txt';
const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'coverage', '__snapshots__']);
const LEGACY_NAME_PATTERN = /(?:ConversationWorkflow|conversationWorkflow)/u;
const LEGACY_PATH_PATTERN = /(?:ConversationWorkflow|conversationWorkflow)/u;
const AGENT_CHOICE_CONTEXT_PATTERN = /(?:ConversationWorkflow|conversationWorkflow|RendererEnsureAiConversationRequest|aiInvocationPort\.ensureConversation|ensureConversationMock|conversation\.flow\.pluginRun\.workflowUnavailable)/u;

const BASELINE_HEADER = [
  '# Conversation agent-choice legacy workflow naming surface (INV-55)',
  '# 格式：count<TAB>rule<TAB>file<TAB>name。只允许数量减少；agent 选择必须改用 agent 命名。',
];

export type AgentChoiceNamingRuleId =
  | 'AGENT-CHOICE-NAMING-01-path'
  | 'AGENT-CHOICE-NAMING-02-symbol'
  | 'AGENT-CHOICE-NAMING-03-workflow-id';

const AGENT_CHOICE_NAMING_RULE_IDS = new Set<AgentChoiceNamingRuleId>([
  'AGENT-CHOICE-NAMING-01-path',
  'AGENT-CHOICE-NAMING-02-symbol',
  'AGENT-CHOICE-NAMING-03-workflow-id',
]);

export interface AgentChoiceNamingOccurrence {
  readonly ruleId: AgentChoiceNamingRuleId;
  readonly file: string;
  readonly line: number;
  readonly name: string;
}

export interface AgentChoiceNamingBaselineEntry {
  readonly ruleId: AgentChoiceNamingRuleId;
  readonly file: string;
  readonly name: string;
  readonly count: number;
}

export interface AgentChoiceNamingDiff {
  readonly expanded: readonly AgentChoiceNamingBaselineEntry[];
  readonly reduced: readonly AgentChoiceNamingBaselineEntry[];
}

interface SourceSlice {
  readonly content: string;
  readonly lineOffset: number;
  readonly scriptKind: ts.ScriptKind;
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  return filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function extractSourceSlices(filePath: string, content: string): SourceSlice[] {
  if (!filePath.endsWith('.vue')) {
    return [{ content, lineOffset: 0, scriptKind: scriptKindFor(filePath) }];
  }

  const slices: SourceSlice[] = [];
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

function occurrence(
  ruleId: AgentChoiceNamingRuleId,
  file: string,
  sourceFile: ts.SourceFile,
  lineOffset: number,
  node: ts.Node,
  name: string,
): AgentChoiceNamingOccurrence {
  return {
    ruleId,
    file,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + lineOffset + 1,
    name,
  };
}

/** 分析单个源码文件；只识别旧 agent-choice 表面，不把合法 workflow 一并封死。 */
export function analyzeConversationAgentChoiceNaming(
  filePath: string,
  content: string,
): AgentChoiceNamingOccurrence[] {
  const file = normalizePath(filePath);
  const occurrences: AgentChoiceNamingOccurrence[] = [];

  for (const segment of file.split('/')) {
    const stem = segment.replace(/\.[^.]+$/u, '');
    if (!LEGACY_PATH_PATTERN.test(stem)) continue;
    occurrences.push({
      ruleId: 'AGENT-CHOICE-NAMING-01-path',
      file,
      line: 1,
      name: stem,
    });
  }

  const isAgentChoiceContext = AGENT_CHOICE_CONTEXT_PATTERN.test(content);
  for (const slice of extractSourceSlices(file, content)) {
    const sourceFile = ts.createSourceFile(
      file,
      slice.content,
      ts.ScriptTarget.Latest,
      true,
      slice.scriptKind,
    );

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && LEGACY_NAME_PATTERN.test(node.text)) {
        occurrences.push(occurrence(
          'AGENT-CHOICE-NAMING-02-symbol',
          file,
          sourceFile,
          slice.lineOffset,
          node,
          node.text,
        ));
      } else if (
        ts.isStringLiteralLike(node)
        && (LEGACY_NAME_PATTERN.test(node.text) || node.text.includes('conversation-workflow'))
      ) {
        occurrences.push(occurrence(
          'AGENT-CHOICE-NAMING-02-symbol',
          file,
          sourceFile,
          slice.lineOffset,
          node,
          node.text,
        ));
      }

      if (
        isAgentChoiceContext
        && ((ts.isIdentifier(node) && node.text === 'workflowId')
          || (ts.isStringLiteralLike(node) && node.text === 'workflowId'))
      ) {
        occurrences.push(occurrence(
          'AGENT-CHOICE-NAMING-03-workflow-id',
          file,
          sourceFile,
          slice.lineOffset,
          node,
          'workflowId',
        ));
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  return occurrences;
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

export function collectConversationAgentChoiceNamingOccurrences(): AgentChoiceNamingOccurrence[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) collectFiles(path.join(REPO_ROOT, root), files);
  return files.flatMap((absolute) => {
    const relative = normalizePath(path.relative(REPO_ROOT, absolute));
    return analyzeConversationAgentChoiceNaming(relative, fs.readFileSync(absolute, 'utf8'));
  });
}

function entryKey(entry: Pick<AgentChoiceNamingBaselineEntry, 'ruleId' | 'file' | 'name'>): string {
  return `${entry.ruleId}\t${entry.file}\t${entry.name}`;
}

export function summarizeConversationAgentChoiceNaming(
  occurrences: readonly AgentChoiceNamingOccurrence[],
): AgentChoiceNamingBaselineEntry[] {
  const entries = new Map<string, AgentChoiceNamingBaselineEntry>();
  for (const item of occurrences) {
    const key = entryKey(item);
    const current = entries.get(key);
    entries.set(key, {
      ruleId: item.ruleId,
      file: item.file,
      name: item.name,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...entries.values()].sort((left, right) => entryKey(left).localeCompare(entryKey(right)));
}

export function compareConversationAgentChoiceNaming(
  current: readonly AgentChoiceNamingBaselineEntry[],
  baseline: readonly AgentChoiceNamingBaselineEntry[],
): AgentChoiceNamingDiff {
  const currentByKey = new Map(current.map(entry => [entryKey(entry), entry]));
  const baselineByKey = new Map(baseline.map(entry => [entryKey(entry), entry]));
  const keys = new Set([...currentByKey.keys(), ...baselineByKey.keys()]);
  const expanded: AgentChoiceNamingBaselineEntry[] = [];
  const reduced: AgentChoiceNamingBaselineEntry[] = [];

  for (const key of keys) {
    const currentEntry = currentByKey.get(key);
    const baselineEntry = baselineByKey.get(key);
    const currentCount = currentEntry?.count ?? 0;
    const baselineCount = baselineEntry?.count ?? 0;
    if (currentCount > baselineCount && currentEntry) expanded.push(currentEntry);
    if (currentCount < baselineCount && baselineEntry) {
      reduced.push({ ...baselineEntry, count: currentCount });
    }
  }

  return {
    expanded: expanded.sort((left, right) => entryKey(left).localeCompare(entryKey(right))),
    reduced: reduced.sort((left, right) => entryKey(left).localeCompare(entryKey(right))),
  };
}

export function parseConversationAgentChoiceNamingBaseline(
  content: string,
): AgentChoiceNamingBaselineEntry[] {
  const entries = content
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const [countText, ruleId, file, name, ...rest] = line.split('\t');
      const count = Number.parseInt(countText ?? '', 10);
      if (
        rest.length > 0
        || !Number.isInteger(count)
        || count < 1
        || !ruleId
        || !file
        || !name
      ) {
        throw new Error(`无效 baseline 行：${line}`);
      }
      const validatedRuleId = [...AGENT_CHOICE_NAMING_RULE_IDS]
        .find(candidate => candidate === ruleId);
      if (!validatedRuleId) throw new Error(`无效 baseline rule：${ruleId}`);
      return { count, ruleId: validatedRuleId, file, name };
    });

  const keys = entries.map(entryKey);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length > 0) {
    throw new Error(`baseline 存在重复项：${[...new Set(duplicates)].join(', ')}`);
  }
  return entries.sort((left, right) => entryKey(left).localeCompare(entryKey(right)));
}

export function formatConversationAgentChoiceNamingBaseline(
  entries: readonly AgentChoiceNamingBaselineEntry[],
): string {
  const rows = entries
    .filter(entry => entry.count > 0)
    .sort((left, right) => entryKey(left).localeCompare(entryKey(right)))
    .map(entry => `${entry.count}\t${entry.ruleId}\t${entry.file}\t${entry.name}`);
  return `${[...BASELINE_HEADER, ...rows].join('\n')}\n`;
}

function readCurrentEntries(): AgentChoiceNamingBaselineEntry[] {
  return summarizeConversationAgentChoiceNaming(collectConversationAgentChoiceNamingOccurrences());
}

export function runConversationAgentChoiceNamingRatchet(): AgentChoiceNamingDiff {
  const current = readCurrentEntries();
  const baseline = parseConversationAgentChoiceNamingBaseline(
    fs.readFileSync(path.join(REPO_ROOT, BASELINE_PATH), 'utf8'),
  );
  return compareConversationAgentChoiceNaming(current, baseline);
}

function writeBaseline(entries: readonly AgentChoiceNamingBaselineEntry[]): void {
  fs.writeFileSync(
    path.join(REPO_ROOT, BASELINE_PATH),
    formatConversationAgentChoiceNamingBaseline(entries),
  );
}

function stageBaseline(): void {
  const result = spawnSync('git', ['add', '--', BASELINE_PATH], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`baseline 已收紧，但 git add 失败：${result.stderr || result.stdout}`);
  }
}

function describeEntry(entry: AgentChoiceNamingBaselineEntry): string {
  return `${entry.file} | ${entry.name} | count=${entry.count}`;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const shouldUpdate = args.has('--update-baseline');
  const shouldStage = args.has('--stage-baseline');
  const diff = runConversationAgentChoiceNamingRatchet();

  if (diff.expanded.length > 0) {
    console.error('✗ Conversation agent 选择的旧 workflow 命名继续扩张（违反 INV-55）');
    for (const entry of diff.expanded) console.error(`  + ${describeEntry(entry)}`);
    console.error('\nagent 选择必须使用 agent / selectedAgent 命名；workflow 保留给显式工作流产品。');
    process.exitCode = 1;
    return;
  }

  if (diff.reduced.length === 0) {
    console.log('✓ Conversation agent-choice workflow naming ratchet: baseline exact');
    return;
  }

  if (!shouldUpdate) {
    console.error('✗ 旧 workflow 命名已减少，但 baseline 尚未收紧：');
    for (const entry of diff.reduced) console.error(`  - ${describeEntry(entry)}`);
    console.error('\n请运行 pnpm run guard:conversation-agent-choice-naming:update。');
    process.exitCode = 1;
    return;
  }

  writeBaseline(readCurrentEntries());
  if (shouldStage) stageBaseline();
  console.log(`✓ Conversation agent-choice workflow naming baseline 收紧 ${diff.reduced.length} 项`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
