/**
 * Host 插件 ID 棘轮。
 *
 * 插件开发标准要求 Core 不持有具体插件 ID：页面、能力和授信按 manifest 与装配来源接入，
 * 不在 Host 里写 `if (pluginId === 'xxx')`。本守卫扫描 Host 生产源码（`src/`、`apps/renderer/`，
 * 不含测试与开发夹具），找出以插件身份使用的工作区插件 ID：
 *
 * - 包含 `plugins/<id>`、`plugin://<id>` 的字符串（路径、路由、资源地址）；
 * - 名称含 plugin 的调用参数、属性值，或与名称含 plugin 的表达式比较、`switch` 分支。
 *
 * 只认这些插件身份位置，是因为 `decision`、`slides`、`canvas` 也是普通单词；类型位置的字面量不算。
 * 现存的引用记在 baseline 里，只允许减少：新增一处“文件 × 插件 ID”会让门禁失败。
 * 先存进常量再使用的写法识别不到，评审时仍按插件开发标准把关。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = process.cwd();
const PLUGINS_ROOT = 'packages/plugins';
const SCAN_ROOTS = ['src', 'apps/renderer'];
const BASELINE_PATH = '.baseline/host-plugin-id-references.txt';

const BASELINE_HEADER = [
  '# Host 插件 ID 引用基线：<插件 ID> <文件>',
  '# 只允许删除。Host 接入插件请走 manifest、contribution 与装配来源授信；确需新增时手工加行，并在提交说明里写明理由。',
];

const PLUGIN_NAME = /plugin/i;
const SOURCE_FILE = /\.(?:ts|mts|cts|js|mjs|cjs|vue)$/;
const NON_RUNTIME = /(?:^|\/)(?:__tests__|__mocks__|fixtures?|dev)\/|\.(?:test|spec)\.|\.d\.ts$/;

export interface PluginIdReference {
  readonly pluginId: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface BaselineDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly references: readonly PluginIdReference[];
}

/** 工作区插件 ID 以各包 plugin.json 为准；clean clone 删除下游插件后集合自然收缩。 */
export function readWorkspacePluginIds(repoRoot = REPO_ROOT): string[] {
  const pluginsRoot = path.join(repoRoot, PLUGINS_ROOT);
  if (!fs.existsSync(pluginsRoot)) return [];
  return fs.readdirSync(pluginsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(pluginsRoot, entry.name, 'plugin.json'))
    .filter(manifestPath => fs.existsSync(manifestPath))
    .map(manifestPath => (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort();
}

function listSourceFiles(directory: string, repoRoot: string): string[] {
  if (!fs.existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(absolute, repoRoot));
    else if (SOURCE_FILE.test(entry.name)) {
      const relative = path.relative(repoRoot, absolute).split(path.sep).join('/');
      if (!NON_RUNTIME.test(relative)) files.push(relative);
    }
  }
  return files;
}

/** Vue SFC 只取 script 块；模板里的静态文本不构成插件身份分支。 */
function readScriptText(absolutePath: string): string {
  const content = fs.readFileSync(absolutePath, 'utf8');
  if (!absolutePath.endsWith('.vue')) return content;
  return [...content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
}

function isTypePosition(node: ts.Node): boolean {
  return ts.isLiteralTypeNode(node.parent);
}

function nameText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile);
}

function isPluginIdentityPosition(node: ts.StringLiteralLike, sourceFile: ts.SourceFile): boolean {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.arguments.includes(node as ts.Expression)) {
    return PLUGIN_NAME.test(nameText(parent.expression, sourceFile));
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    return PLUGIN_NAME.test(nameText(parent.name, sourceFile));
  }
  if (ts.isBinaryExpression(parent)) {
    const other = parent.left === node ? parent.right : parent.left;
    return PLUGIN_NAME.test(nameText(other, sourceFile));
  }
  if (ts.isCaseClause(parent) && ts.isCaseBlock(parent.parent) && ts.isSwitchStatement(parent.parent.parent)) {
    return PLUGIN_NAME.test(nameText(parent.parent.parent.expression, sourceFile));
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 找出一段源码里以插件身份出现的插件 ID。 */
export function findPluginIdReferences(source: string, fileName: string, pluginIds: readonly string[]): PluginIdReference[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const pathPatterns = pluginIds.map(id => ({
    id,
    pattern: new RegExp(`(?:^|[/\\\\])plugins[/\\\\]${escapeRegExp(id)}(?:$|[/\\\\?#])|plugin://${escapeRegExp(id)}(?:$|/)`),
  }));
  const references: PluginIdReference[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && !isTypePosition(node)) {
      const value = node.text;
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const pathMatch = pathPatterns.find(({ pattern }) => pattern.test(value));
      if (pathMatch) references.push({ pluginId: pathMatch.id, file: fileName, line, text: value });
      else if (pluginIds.includes(value) && isPluginIdentityPosition(node, sourceFile)) {
        references.push({ pluginId: value, file: fileName, line, text: node.parent.getText(sourceFile).slice(0, 120) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

export function scanHostPluginIdReferences(repoRoot = REPO_ROOT): PluginIdReference[] {
  const pluginIds = readWorkspacePluginIds(repoRoot);
  if (pluginIds.length === 0) return [];
  return SCAN_ROOTS.flatMap(root => listSourceFiles(path.join(repoRoot, root), repoRoot))
    .flatMap(file => findPluginIdReferences(readScriptText(path.join(repoRoot, file)), file, pluginIds));
}

export function referenceKey(reference: Pick<PluginIdReference, 'pluginId' | 'file'>): string {
  return `${reference.pluginId} ${reference.file}`;
}

export function readBaseline(content: string): string[] {
  return content.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#'));
}

export function compareWithBaseline(references: readonly PluginIdReference[], baseline: readonly string[]): BaselineDiff {
  const current = new Set(references.map(referenceKey));
  const allowed = new Set(baseline);
  return {
    added: [...current].filter(key => !allowed.has(key)).sort(),
    removed: [...allowed].filter(key => !current.has(key)).sort(),
    references,
  };
}

export function runHostPluginIdRatchet(repoRoot = REPO_ROOT): BaselineDiff {
  const baselinePath = path.join(repoRoot, BASELINE_PATH);
  const baseline = fs.existsSync(baselinePath) ? readBaseline(fs.readFileSync(baselinePath, 'utf8')) : [];
  return compareWithBaseline(scanHostPluginIdReferences(repoRoot), baseline);
}

function writeBaseline(keys: readonly string[]): void {
  fs.writeFileSync(path.join(REPO_ROOT, BASELINE_PATH), `${[...BASELINE_HEADER, ...[...keys].sort()].join('\n')}\n`);
}

function stageBaseline(): void {
  const result = spawnSync('git', ['add', '--', BASELINE_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`baseline 已收紧，但 git add 失败：${result.stderr || result.stdout}`);
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const result = runHostPluginIdRatchet();

  if (result.added.length > 0) {
    console.error('✗ Host 生产源码新增了具体插件 ID 引用：');
    for (const key of result.added) {
      console.error(`  + ${key}`);
      for (const reference of result.references.filter(item => referenceKey(item) === key)) {
        console.error(`      ${reference.file}:${reference.line}  ${reference.text}`);
      }
    }
    console.error('\nHost 接入插件请走 manifest、contribution 与装配来源授信（docs/plugins/README.md）。确需新增时手工写入 '
      + `${BASELINE_PATH}，并在提交说明里写明理由。`);
    process.exitCode = 1;
    return;
  }

  if (result.removed.length === 0) {
    console.log('✓ Host plugin id ratchet: baseline exact');
    return;
  }

  if (!args.has('--update-baseline')) {
    console.error('✗ 插件 ID 引用已经减少，但 baseline 仍保留这些条目：');
    for (const key of result.removed) console.error(`  - ${key}`);
    console.error('\n请运行 pnpm run guard:host-plugin-id:update 收紧 baseline。');
    process.exitCode = 1;
    return;
  }

  const removed = new Set(result.removed);
  const baseline = readBaseline(fs.readFileSync(path.join(REPO_ROOT, BASELINE_PATH), 'utf8'));
  writeBaseline(baseline.filter(key => !removed.has(key)));
  if (args.has('--stage-baseline')) stageBaseline();
  console.log(`✓ Host plugin id baseline 收紧 ${result.removed.length} 项`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
