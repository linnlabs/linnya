/**
 * Renderer 样式刻度棘轮。
 *
 * 设计规范要求字号、字重、行高、圆角、间距、层级与动效从 Renderer UI token 取值，
 * 颜色只引用随主题切换的语义 token，不直接引用基础色阶；过渡必须列出具体属性，不写 transition: all。
 * 存量写死值允许在迁移中减少，但任何文件都不能新增；token owner 文件不在扫描范围内。
 * 规则含义见 packages/renderer-ui/docs/design.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ['apps/renderer', 'packages/renderer-ui/src'] as const;
const BASELINE_PATH = '.baseline/renderer-style-scale.txt';
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'coverage', '__snapshots__']);

/* token owner 与第三方主题文件可以定义原始刻度值。 */
const EXEMPT_PATH_PREFIXES = [
  'packages/renderer-ui/src/styles/tokens/',
  'apps/renderer/app/styles/tokens/',
  'apps/renderer/domains/editor/styles/tokens/',
  'apps/renderer/domains/sheet/react-ref/univer/',
] as const;
/* 开发期诊断与试验页面不属于产品界面，不纳入刻度债务。 */
const EXEMPT_PATH_FRAGMENTS = [
  'apps/renderer/app/styles/base/debug.css',
  'apps/renderer/domains/conversation/features/virtualizer-spike/',
  'apps/renderer/domains/editor/styles/components/LlmRequestDebugPanel.css',
] as const;
const EXEMPT_FILES = new Set([
  'packages/renderer-ui/src/styles/tokens.css',
  'apps/renderer/app/styles/base/highlight-github.css',
  'apps/renderer/domains/conversation/styles/theme-tokens.css',
]);

const BASELINE_HEADER = [
  '# Renderer style scale debt (packages/renderer-ui/docs/design.md)',
  '# 格式：count<TAB>rule<TAB>file。只允许数量减少；新增值必须使用 Renderer UI token。',
];

export type StyleScaleRuleId =
  | 'SCALE-01-font-size'
  | 'SCALE-02-font-weight'
  | 'SCALE-03-line-height'
  | 'SCALE-04-radius'
  | 'SCALE-05-spacing'
  | 'SCALE-06-z-index'
  | 'SCALE-07-duration'
  | 'SCALE-08-easing'
  | 'SCALE-09-legacy-alias'
  | 'COLOR-01-base-palette'
  | 'MOTION-01-transition-all';

const STYLE_SCALE_RULE_IDS = new Set<StyleScaleRuleId>([
  'SCALE-01-font-size',
  'SCALE-02-font-weight',
  'SCALE-03-line-height',
  'SCALE-04-radius',
  'SCALE-05-spacing',
  'SCALE-06-z-index',
  'SCALE-07-duration',
  'SCALE-08-easing',
  'SCALE-09-legacy-alias',
  'COLOR-01-base-palette',
  'MOTION-01-transition-all',
]);

export interface StyleScaleBaselineEntry {
  readonly ruleId: StyleScaleRuleId;
  readonly file: string;
  readonly count: number;
}

export interface StyleScaleDiff {
  readonly expanded: readonly StyleScaleBaselineEntry[];
  readonly reduced: readonly StyleScaleBaselineEntry[];
}

const LENGTH_PATTERN = /(?<![\w-])-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)\b/gu;
/* em 与百分比是相对当前上下文的字号（文档内容排版、图标跟随文字），不是绕过角色字阶的绝对值。 */
const ABSOLUTE_FONT_SIZE_PATTERN = /(?<![\w-])-?(?:\d+\.?\d*|\.\d+)(?:px|rem)\b/gu;
const DURATION_PATTERN = /(?<![\w-])(?:\d+\.?\d*|\.\d+)m?s\b/gu;
const EASING_PATTERN = /cubic-bezier\(|(?<![\w-])ease(?:-in-out|-in|-out)?(?![\w-])/gu;
/* 基础色阶不随主题切换；黑白只用于遮罩、投影与固定深色蒙层上的文字，不在此统计。 */
const BASE_PALETTE_PATTERN = /var\(\s*--color-(?:(?:gray|red|blue|yellow|brand)-\d+|dark-(?:bg|surface|elevated))\s*\)/gu;
/* transition 列表中任一段以 all 开头，都会让布局、颜色等无关属性一起参与动画。 */
const TRANSITION_ALL_PATTERN = /(?:^|,)\s*all(?![\w-])/gu;
const LEGACY_ALIAS_PATTERN = /var\(\s*--(?:spacing-(?:xxs|xs|sm|md|lg|xl|2xl)|transition-(?:fast|normal|slow))\b/gu;
const SPACING_PROPERTY_PATTERN = /^(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?$|^(?:row-|column-)?gap$/u;
const RADIUS_PROPERTY_PATTERN = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/u;
const DURATION_PROPERTIES = new Set([
  'transition',
  'transition-duration',
  'transition-delay',
  'animation',
  'animation-duration',
  'animation-delay',
]);
const EASING_PROPERTIES = new Set([
  'transition',
  'transition-timing-function',
  'animation',
  'animation-timing-function',
]);

/** 把 var(...) 的参数折叠掉，避免 token 名中的数字被当作写死值。 */
function stripVarReferences(value: string): string {
  let current = value;
  for (;;) {
    const next = current.replace(/var\([^()]*\)/gu, 'var()');
    if (next === current) return current;
    current = next;
  }
}

function countMatches(value: string, pattern: RegExp, accept: (match: string) => boolean = () => true): number {
  return [...value.matchAll(pattern)].filter(match => accept(match[0])).length;
}

function isNonZeroNumber(text: string): boolean {
  return Number.parseFloat(text) !== 0;
}

function isBeyondHairline(text: string): boolean {
  return Math.abs(Number.parseFloat(text)) > 1;
}

/**
 * 间距刻度最大到 40px；更大的值是版面尺寸（空态留白、固定列宽），不属于间距刻度。
 * `em` 是随当前字号缩放的相对间距（文档内容排版的垂直节奏），不是绕过刻度的绝对值。
 */
function isSpacingScaleCandidate(text: string): boolean {
  if (/(?<!r)em$/u.test(text)) return false;
  const value = Math.abs(Number.parseFloat(text));
  return value > 1 && value <= 40;
}

/**
 * 统计单条声明违反规则的次数。基础色阶在自定义属性定义里同样统计；
 * 刻度类规则只看真实属性，自定义属性由其定义者负责。
 */
export function analyzeStyleScaleDeclaration(property: string, rawValue: string): Map<StyleScaleRuleId, number> {
  const counts = new Map<StyleScaleRuleId, number>();
  const name = property.trim().toLowerCase();
  const value = rawValue.replace(/!important/giu, '').trim();
  const add = (ruleId: StyleScaleRuleId, count: number): void => {
    if (count > 0) counts.set(ruleId, (counts.get(ruleId) ?? 0) + count);
  };

  add('COLOR-01-base-palette', countMatches(value, BASE_PALETTE_PATTERN));
  if (name.startsWith('--')) return counts;

  add('SCALE-09-legacy-alias', countMatches(value, LEGACY_ALIAS_PATTERN));
  const literal = stripVarReferences(value);

  if (name === 'font-size') {
    add('SCALE-01-font-size', countMatches(literal, ABSOLUTE_FONT_SIZE_PATTERN));
  } else if (name === 'font-weight') {
    add('SCALE-02-font-weight', /^(?:\d{3}|bold|bolder|lighter)$/u.test(literal) ? 1 : 0);
  } else if (name === 'line-height') {
    const isNumeric = /^(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%)?$/u.test(literal);
    /* 24px 及以上的像素行高是控件内垂直居中用的高度，不是文字行距。 */
    const isControlHeight = /^(?:\d+\.?\d*)px$/u.test(literal) && Number.parseFloat(literal) >= 24;
    add('SCALE-03-line-height', isNumeric && literal !== '0' && literal !== '1' && !isControlHeight ? 1 : 0);
  } else if (RADIUS_PROPERTY_PATTERN.test(name)) {
    add('SCALE-04-radius', countMatches(literal, LENGTH_PATTERN, isNonZeroNumber));
  } else if (SPACING_PROPERTY_PATTERN.test(name)) {
    add('SCALE-05-spacing', countMatches(literal, LENGTH_PATTERN, isSpacingScaleCandidate));
  } else if (name === 'z-index') {
    add('SCALE-06-z-index', /^-?\d+$/u.test(literal) && Math.abs(Number(literal)) >= 10 ? 1 : 0);
  }

  if (name === 'transition' || name === 'transition-property') {
    add('MOTION-01-transition-all', countMatches(literal, TRANSITION_ALL_PATTERN));
  }

  /* 循环动画（infinite）的周期由动画本身决定，不套时长刻度；规范只给出 --duration-loop 一个参考值。 */
  const isLoopingAnimation = name.startsWith('animation') && /(?<![\w-])infinite(?![\w-])/u.test(literal);

  if (DURATION_PROPERTIES.has(name) && !isLoopingAnimation) {
    add('SCALE-07-duration', countMatches(literal, DURATION_PATTERN, isNonZeroNumber));
  }
  if (EASING_PROPERTIES.has(name) && !isLoopingAnimation) {
    add('SCALE-08-easing', countMatches(literal, EASING_PATTERN));
  }

  return counts;
}

/** 汇总一份 CSS 源码中的刻度债务。只读取声明块，不解析选择器或 at-rule 参数。 */
export function analyzeStyleScaleSource(source: string): Map<StyleScaleRuleId, number> {
  const totals = new Map<StyleScaleRuleId, number>();
  /* 声明后紧跟 `scale-exempt: 原因` 注释，表示该值是刻度之外的有意取值（如图标字形尺寸）。 */
  const withoutExempt = source.replace(/[^;{}]*;\s*\/\*\s*scale-exempt:[\s\S]*?\*\//gu, '');
  const withoutComments = withoutExempt.replace(/\/\*[\s\S]*?\*\//gu, '');

  for (const block of withoutComments.matchAll(/\{([^{}]*)\}/gu)) {
    for (const declaration of block[1].split(';')) {
      const separator = declaration.indexOf(':');
      if (separator <= 0) continue;
      const property = declaration.slice(0, separator);
      if (!/^\s*-{0,2}[a-z][a-z0-9-]*\s*$/iu.test(property)) continue;
      for (const [ruleId, count] of analyzeStyleScaleDeclaration(property, declaration.slice(separator + 1))) {
        totals.set(ruleId, (totals.get(ruleId) ?? 0) + count);
      }
    }
  }

  return totals;
}

function toRepoPath(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
}

function isExempt(file: string): boolean {
  return (
    EXEMPT_FILES.has(file) ||
    EXEMPT_PATH_PREFIXES.some(prefix => file.startsWith(prefix)) ||
    EXEMPT_PATH_FRAGMENTS.some(fragment => file.includes(fragment))
  );
}

function collectCssFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (IGNORE_DIRS.has(entry.name)) return [];
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectCssFiles(absolutePath);
    return entry.name.endsWith('.css') ? [absolutePath] : [];
  });
}

export function collectStyleScaleEntries(): StyleScaleBaselineEntry[] {
  const entries: StyleScaleBaselineEntry[] = [];
  for (const root of SCAN_ROOTS) {
    for (const absolutePath of collectCssFiles(path.join(REPO_ROOT, root))) {
      const file = toRepoPath(absolutePath);
      if (isExempt(file)) continue;
      for (const [ruleId, count] of analyzeStyleScaleSource(fs.readFileSync(absolutePath, 'utf8'))) {
        entries.push({ ruleId, file, count });
      }
    }
  }
  return sortEntries(entries);
}

function entryKey(entry: Pick<StyleScaleBaselineEntry, 'ruleId' | 'file'>): string {
  return `${entry.ruleId}\u0000${entry.file}`;
}

function sortEntries(entries: readonly StyleScaleBaselineEntry[]): StyleScaleBaselineEntry[] {
  return [...entries].sort((left, right) =>
    left.file.localeCompare(right.file) || left.ruleId.localeCompare(right.ruleId));
}

export function compareStyleScale(
  current: readonly StyleScaleBaselineEntry[],
  baseline: readonly StyleScaleBaselineEntry[],
): StyleScaleDiff {
  const currentByKey = new Map(current.map(entry => [entryKey(entry), entry]));
  const baselineByKey = new Map(baseline.map(entry => [entryKey(entry), entry]));
  const expanded: StyleScaleBaselineEntry[] = [];
  const reduced: StyleScaleBaselineEntry[] = [];

  for (const key of new Set([...currentByKey.keys(), ...baselineByKey.keys()])) {
    const currentEntry = currentByKey.get(key);
    const baselineEntry = baselineByKey.get(key);
    const currentCount = currentEntry?.count ?? 0;
    const baselineCount = baselineEntry?.count ?? 0;
    if (currentCount > baselineCount && currentEntry) {
      expanded.push({ ...currentEntry, count: currentCount - baselineCount });
    }
    if (currentCount < baselineCount && baselineEntry) {
      reduced.push({ ...baselineEntry, count: currentCount });
    }
  }

  return { expanded: sortEntries(expanded), reduced: sortEntries(reduced) };
}

export function parseStyleScaleBaseline(source: string): StyleScaleBaselineEntry[] {
  const entries = source
    .split(/\r?\n/u)
    .filter(line => line.trim() !== '' && !line.startsWith('#'))
    .map(line => {
      const [countText, ruleId, file, extra] = line.split('\t');
      const count = Number(countText);
      if (!ruleId || !file || extra !== undefined || !Number.isInteger(count) || count <= 0) {
        throw new Error(`无效 baseline 行：${line}`);
      }
      if (!STYLE_SCALE_RULE_IDS.has(ruleId as StyleScaleRuleId)) {
        throw new Error(`无效 baseline rule：${ruleId}`);
      }
      return { ruleId: ruleId as StyleScaleRuleId, file, count };
    });

  const keys = entries.map(entryKey);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length > 0) {
    throw new Error(`baseline 存在重复项：${[...new Set(duplicates)].join(', ')}`);
  }
  return entries;
}

export function formatStyleScaleBaseline(entries: readonly StyleScaleBaselineEntry[]): string {
  const lines = sortEntries(entries).map(entry => `${entry.count}\t${entry.ruleId}\t${entry.file}`);
  return `${[...BASELINE_HEADER, ...lines].join('\n')}\n`;
}

export function runStyleScaleRatchet(): StyleScaleDiff {
  const baseline = parseStyleScaleBaseline(fs.readFileSync(path.join(REPO_ROOT, BASELINE_PATH), 'utf8'));
  return compareStyleScale(collectStyleScaleEntries(), baseline);
}

function stageBaseline(): void {
  const result = spawnSync('git', ['add', '--', BASELINE_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`baseline 已收紧，但 git add 失败：${result.stderr || result.stdout}`);
  }
}

function describeEntry(entry: StyleScaleBaselineEntry): string {
  return `${entry.file} | ${entry.ruleId} | count=${entry.count}`;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const baselineFile = path.join(REPO_ROOT, BASELINE_PATH);
  const diff = runStyleScaleRatchet();
  if (diff.expanded.length > 0) {
    console.error('✗ Renderer 样式新增了未使用 token 的刻度值或基础色阶引用：');
    for (const entry of diff.expanded) console.error(`  + ${describeEntry(entry)}`);
    console.error('\n请改用 Renderer UI token，规则见 packages/renderer-ui/docs/design.md。');
    process.exitCode = 1;
    return;
  }

  if (diff.reduced.length === 0) {
    console.log('✓ Renderer style scale ratchet: baseline exact');
    return;
  }

  if (!args.has('--update-baseline')) {
    console.error('✗ 写死的刻度值已减少，但 baseline 尚未收紧：');
    for (const entry of diff.reduced) console.error(`  - ${describeEntry(entry)}`);
    console.error('\n请运行 pnpm run guard:renderer-style-scale:update。');
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(baselineFile, formatStyleScaleBaseline(collectStyleScaleEntries()));
  if (args.has('--stage-baseline')) stageBaseline();
  console.log(`✓ Renderer style scale baseline 收紧 ${diff.reduced.length} 项`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
