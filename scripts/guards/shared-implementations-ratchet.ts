/**
 * 共享实现棘轮。
 *
 * 已经有共享实现的写法（见 shared-implementations/definitions/sharedImplementationRules.ts）
 * 不能在共享位置以外再出现。存量允许在迁移中减少，但任何文件都不能新增。
 * 规范见 docs/development/code-quality.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  SHARED_IMPLEMENTATION_RULES,
  type SharedImplementationRule,
} from './shared-implementations/definitions/sharedImplementationRules';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ['apps', 'src', 'packages'] as const;
const BASELINE_PATH = '.baseline/shared-implementations.txt';
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'coverage', '__snapshots__', '__tests__', '__test__', 'fixtures']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs', '.cjs']);
/* 测试可以为了隔离自带小工具；类型声明不含实现。 */
const IGNORE_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/u;

const BASELINE_HEADER = [
  '# Shared implementation debt (docs/development/code-quality.md)',
  '# 格式：count<TAB>rule<TAB>file。只允许数量减少；新代码必须使用共享实现。',
];

export interface SharedImplementationEntry {
  readonly ruleId: string;
  readonly file: string;
  readonly count: number;
}

export interface SharedImplementationDiff {
  readonly expanded: readonly SharedImplementationEntry[];
  readonly reduced: readonly SharedImplementationEntry[];
}

const entryKey = (entry: SharedImplementationEntry): string => `${entry.ruleId}\t${entry.file}`;

function sortEntries(entries: readonly SharedImplementationEntry[]): SharedImplementationEntry[] {
  return [...entries].sort((left, right) => entryKey(left).localeCompare(entryKey(right), 'en'));
}

function listSourceFiles(directory: string, files: string[]): void {
  for (const entry of fs.readdirSync(path.join(REPO_ROOT, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) listSourceFiles(relative, files);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !IGNORE_FILE_PATTERN.test(entry.name)) {
      files.push(relative);
    }
  }
}

function ruleApplies(rule: SharedImplementationRule, file: string): boolean {
  if (rule.exclude?.some(prefix => file.startsWith(prefix))) return false;
  if (rule.owners.some(owner => file.startsWith(owner))) return false;
  return rule.scope === undefined || rule.scope.some(scope => file.startsWith(scope));
}

/** 一个文件里每条规则命中的行数。 */
export function countSharedImplementationHits(
  file: string, source: string, rules: readonly SharedImplementationRule[] = SHARED_IMPLEMENTATION_RULES,
): SharedImplementationEntry[] {
  const applicable = rules.filter(rule => ruleApplies(rule, file));
  if (applicable.length === 0) return [];
  const lines = source.split(/\r?\n/u);
  return applicable
    .map(rule => ({ ruleId: rule.id, file, count: rule.wholeSource ? [...source.matchAll(rule.pattern)].length : lines.filter(line => rule.pattern.test(line)).length }))
    .filter(entry => entry.count > 0);
}

export function collectSharedImplementationEntries(): SharedImplementationEntry[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) listSourceFiles(root, files);
  return sortEntries(files.flatMap(file => (
    countSharedImplementationHits(file, fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'))
  )));
}

export function compareSharedImplementations(
  current: readonly SharedImplementationEntry[], baseline: readonly SharedImplementationEntry[],
): SharedImplementationDiff {
  const currentByKey = new Map(current.map(entry => [entryKey(entry), entry]));
  const baselineByKey = new Map(baseline.map(entry => [entryKey(entry), entry]));
  const expanded: SharedImplementationEntry[] = [];
  const reduced: SharedImplementationEntry[] = [];
  for (const key of new Set([...currentByKey.keys(), ...baselineByKey.keys()])) {
    const currentEntry = currentByKey.get(key);
    const baselineEntry = baselineByKey.get(key);
    const currentCount = currentEntry?.count ?? 0;
    const baselineCount = baselineEntry?.count ?? 0;
    if (currentCount > baselineCount && currentEntry) expanded.push({ ...currentEntry, count: currentCount - baselineCount });
    if (currentCount < baselineCount && baselineEntry) reduced.push({ ...baselineEntry, count: currentCount });
  }
  return { expanded: sortEntries(expanded), reduced: sortEntries(reduced) };
}

export function parseSharedImplementationBaseline(source: string): SharedImplementationEntry[] {
  const ruleIds = new Set(SHARED_IMPLEMENTATION_RULES.map(rule => rule.id));
  const entries = source
    .split(/\r?\n/u)
    .filter(line => line.trim() !== '' && !line.startsWith('#'))
    .map(line => {
      const [countText, ruleId, file, extra] = line.split('\t');
      const count = Number(countText);
      if (!ruleId || !file || extra !== undefined || !Number.isInteger(count) || count <= 0) {
        throw new Error(`无效 baseline 行：${line}`);
      }
      if (!ruleIds.has(ruleId)) throw new Error(`无效 baseline rule：${ruleId}`);
      return { ruleId, file, count };
    });
  const keys = entries.map(entryKey);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length > 0) throw new Error(`baseline 存在重复项：${[...new Set(duplicates)].join(', ')}`);
  return entries;
}

export function formatSharedImplementationBaseline(entries: readonly SharedImplementationEntry[]): string {
  const lines = sortEntries(entries).map(entry => `${entry.count}\t${entry.ruleId}\t${entry.file}`);
  return `${[...BASELINE_HEADER, ...lines].join('\n')}\n`;
}

function stageBaseline(): void {
  const result = spawnSync('git', ['add', '--', BASELINE_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`baseline 已收紧，但 git add 失败：${result.stderr || result.stdout}`);
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const baselineFile = path.join(REPO_ROOT, BASELINE_PATH);
  const current = collectSharedImplementationEntries();
  const baseline = fs.existsSync(baselineFile)
    ? parseSharedImplementationBaseline(fs.readFileSync(baselineFile, 'utf8'))
    : [];
  const diff = compareSharedImplementations(current, baseline);
  const useByRule = new Map(SHARED_IMPLEMENTATION_RULES.map(rule => [rule.id, rule.use]));

  if (diff.expanded.length > 0 && !args.has('--init-baseline')) {
    console.error('✗ 新增了已有共享实现的本地写法：');
    for (const entry of diff.expanded) console.error(`  + ${entry.file} | ${entry.ruleId} | count=${entry.count}`);
    console.error('');
    for (const ruleId of new Set(diff.expanded.map(entry => entry.ruleId))) {
      console.error(`  ${ruleId}：${useByRule.get(ruleId)}`);
    }
    console.error('\n规范见 docs/development/code-quality.md。');
    process.exitCode = 1;
    return;
  }

  if (diff.reduced.length === 0 && diff.expanded.length === 0) {
    const total = current.reduce((sum, entry) => sum + entry.count, 0);
    console.log(`✓ Shared implementations ratchet: baseline exact（存量 ${total} 处）`);
    return;
  }

  if (!args.has('--update-baseline') && !args.has('--init-baseline')) {
    console.error('✗ 本地重复写法已减少，但 baseline 尚未收紧：');
    for (const entry of diff.reduced) console.error(`  - ${entry.file} | ${entry.ruleId} | count=${entry.count}`);
    console.error('\n请运行 pnpm run guard:shared-implementations:update。');
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(baselineFile, formatSharedImplementationBaseline(current));
  if (args.has('--stage-baseline')) stageBaseline();
  console.log(`✓ Shared implementations baseline 已更新：减少 ${diff.reduced.length} 项${diff.expanded.length ? `，初始化新增 ${diff.expanded.length} 项` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
