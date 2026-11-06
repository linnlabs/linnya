/**
 * 插件 SQL 表归属棘轮。
 *
 * 插件只直接读写 plugin.json `ownedTables` 声明的自有表；Host 或其他插件的数据要走 Host 端口。
 * 现有的跨表访问记在 baseline 里，只允许减少：新增一种“插件 × 访问方式 × 表”会让门禁失败。
 *
 * 只扫描插件运行时源码 `packages/plugins/<id>/src`，不含测试与开发脚本。SQL 关键字按仓库惯例大写；
 * 小写写成的完整语句会被单独拦下，避免绕过识别。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const REPO_ROOT = process.cwd();
const PLUGINS_ROOT = 'packages/plugins';
const BASELINE_PATH = '.baseline/plugin-table-access.txt';

const BASELINE_HEADER = [
  '# 插件跨表访问基线：<插件> <访问方式> <表>',
  '# 访问方式：read 读取、write 增删改、schema 建表改表建索引、reference 外键引用（指向 workspace_nodes、projects 的外键不计）。',
  '# 只允许删除。新增跨表访问先改用 Host 端口；确需新增时手工加行，并在提交说明里写明理由。',
];

export type TableAccessMode = 'read' | 'write' | 'schema' | 'reference';

export interface TableAccess {
  readonly table: string;
  readonly mode: TableAccessMode;
}

export interface CrossTableAccess {
  readonly key: string;
  readonly files: readonly string[];
}

export interface PluginTableScan {
  readonly accesses: readonly CrossTableAccess[];
  readonly lowercaseSql: readonly string[];
}

export interface BaselineDiff {
  readonly added: readonly CrossTableAccess[];
  readonly removed: readonly string[];
}

/**
 * Host 的身份表。插件行用外键引用它们，随节点或项目一起级联删除，这是插件数据的归属方式，
 * 不算跨表访问；读取或写入这些表仍要走端口。
 */
const HOST_IDENTITY_TABLES = new Set(['workspace_nodes', 'projects']);

/** 模板插值处的占位标识；落在表名位置时记为动态表名。 */
const DYNAMIC_MARKER = '__linnya_dynamic_identifier__';

/** SQLite 自带的目录表与表值函数，不属于任何 owner。 */
const SQLITE_BUILTIN_TABLES = new Set([
  'sqlite_master',
  'sqlite_schema',
  'sqlite_temp_master',
  'sqlite_temp_schema',
  'json_each',
  'json_tree',
]);

const IDENTIFIER = String.raw`(?:(?:main|temp)\.)?(?:"([^"]+)"|\x60([^\x60]+)\x60|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))`;

const SQL_STATEMENT = /\b(?:SELECT|INSERT|REPLACE|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\b/;
const SQL_FRAGMENT = /^\s*(?:FROM|(?:LEFT\s+|INNER\s+|CROSS\s+)?JOIN)\b/;
const LOWERCASE_SQL = [
  /^\s*select\s+[\w*,.\s()]+?\s+from\s+[a-z_]\w*/,
  /^\s*insert\s+(?:or\s+\w+\s+)?into\s+[a-z_]\w*\s*\(/,
  /^\s*update\s+[a-z_]\w*\s+set\s+\w+\s*=/,
  /^\s*delete\s+from\s+[a-z_]\w*(?:\s+where\b|\s*$)/,
  /^\s*(?:create|alter|drop)\s+table\b/,
];

const PATTERNS: ReadonlyArray<{ readonly mode: TableAccessMode; readonly regex: RegExp }> = [
  { mode: 'schema', regex: new RegExp(String.raw`\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENTIFIER}`, 'gi') },
  { mode: 'schema', regex: new RegExp(String.raw`\bALTER\s+TABLE\s+${IDENTIFIER}`, 'gi') },
  { mode: 'schema', regex: new RegExp(String.raw`\bRENAME\s+TO\s+${IDENTIFIER}`, 'gi') },
  { mode: 'schema', regex: new RegExp(String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${IDENTIFIER}`, 'gi') },
  { mode: 'schema', regex: new RegExp(String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+ON\s+${IDENTIFIER}`, 'gi') },
  { mode: 'schema', regex: new RegExp(String.raw`\b(?:BEFORE|AFTER|INSTEAD\s+OF)\s+(?:INSERT|DELETE|UPDATE(?:\s+OF\s+[\w\s,]+?)?)\s+ON\s+${IDENTIFIER}`, 'gi') },
  { mode: 'write', regex: new RegExp(String.raw`\bINSERT\s+(?:OR\s+[A-Z]+\s+)?INTO\s+${IDENTIFIER}`, 'gi') },
  { mode: 'write', regex: new RegExp(String.raw`\bREPLACE\s+INTO\s+${IDENTIFIER}`, 'gi') },
  { mode: 'write', regex: new RegExp(String.raw`\bUPDATE\s+(?:OR\s+[A-Z]+\s+)?${IDENTIFIER}\s+SET\b`, 'gi') },
  { mode: 'write', regex: new RegExp(String.raw`\bDELETE\s+FROM\s+${IDENTIFIER}`, 'gi') },
  { mode: 'reference', regex: new RegExp(String.raw`\bREFERENCES\s+${IDENTIFIER}`, 'gi') },
  { mode: 'read', regex: new RegExp(String.raw`\b(?:FROM|JOIN)\s+${IDENTIFIER}`, 'gi') },
];

const CTE_NAME = new RegExp(String.raw`(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)${IDENTIFIER}\s*(?:\([^)]*\)\s*)?AS\s*(?:NOT\s+)?(?:MATERIALIZED\s+)?\(`, 'gi');

function identifierFrom(match: RegExpExecArray, offset: number): string {
  return (match[offset] ?? match[offset + 1] ?? match[offset + 2] ?? match[offset + 3] ?? '').trim();
}

/** 去掉注释与 SQL 字符串常量，避免把其中的词当成表名。 */
function stripSqlNoise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

export function isSqlText(text: string): boolean {
  return SQL_STATEMENT.test(text) || SQL_FRAGMENT.test(text);
}

export function isLowercaseSql(text: string): boolean {
  return LOWERCASE_SQL.some(pattern => pattern.test(text));
}

/** 从一段 SQL 读出它访问的表；`DELETE FROM` 只算写入，CTE 名与 SQLite 内置表不算。 */
export function findTableAccesses(sql: string): TableAccess[] {
  const cleaned = stripSqlNoise(sql);
  const cteNames = new Set<string>();
  for (const match of cleaned.matchAll(CTE_NAME)) cteNames.add(identifierFrom(match, 1).toLowerCase());

  const masked = cleaned.replace(/\bDELETE\s+FROM\b/gi, 'DELETE ____');
  const accesses = new Map<string, TableAccess>();
  for (const { mode, regex } of PATTERNS) {
    const source = mode === 'read' ? masked : cleaned;
    for (const match of source.matchAll(regex)) {
      const table = identifierFrom(match, 1);
      const lower = table.toLowerCase();
      if (!table || cteNames.has(lower) || SQLITE_BUILTIN_TABLES.has(lower) || lower.startsWith('pragma_')) continue;
      const normalized = table === DYNAMIC_MARKER ? '<dynamic>' : table;
      accesses.set(`${mode} ${normalized}`, { mode, table: normalized });
    }
  }
  return [...accesses.values()];
}

function templateText(node: ts.TemplateExpression): string {
  return node.head.text + node.templateSpans.map(span => DYNAMIC_MARKER + span.literal.text).join('');
}

/** 字符串拼接（`'…' + '…'`）按整段读取，模板插值换成占位标识。 */
function stringValue(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return templateText(node);
  if (ts.isParenthesizedExpression(node)) return stringValue(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = stringValue(node.left);
    const right = stringValue(node.right);
    if (left !== null && right !== null) return left + right;
    if (left !== null) return left + DYNAMIC_MARKER;
    if (right !== null) return DYNAMIC_MARKER + right;
  }
  return null;
}

export function extractStringTexts(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    // 整段拼接与插值内部的字符串都要读：`${cond ? 'JOIN …' : ''}` 里的表同样算访问。
    if (ts.isExpression(node)) {
      const value = stringValue(node);
      if (value !== null) texts.push(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return texts;
}

function isRuntimeSource(relativePath: string): boolean {
  return /\.(?:ts|mts|cts)$/.test(relativePath)
    && !relativePath.endsWith('.d.ts')
    && !/(?:^|\/)__tests__\//.test(relativePath)
    && !/\.(?:test|spec)\.[mc]?ts$/.test(relativePath);
}

function listFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listFiles(absolute);
    return [absolute];
  });
}

interface PluginManifest {
  readonly id: string;
  readonly ownedTables: readonly string[];
}

function readPluginManifest(pluginDirectory: string): PluginManifest | null {
  const manifestPath = path.join(pluginDirectory, 'plugin.json');
  if (!fs.existsSync(manifestPath)) return null;
  const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (typeof manifest !== 'object' || manifest === null || !('id' in manifest) || typeof manifest.id !== 'string') {
    throw new Error(`${manifestPath}: 缺少字符串 id`);
  }
  const owned = 'ownedTables' in manifest ? manifest.ownedTables : [];
  if (!Array.isArray(owned) || !owned.every((table): table is string => typeof table === 'string')) {
    throw new Error(`${manifestPath}: ownedTables 必须是字符串数组`);
  }
  return { id: manifest.id, ownedTables: owned };
}

export function scanPluginTableAccess(repoRoot = REPO_ROOT): PluginTableScan {
  const pluginsRoot = path.join(repoRoot, PLUGINS_ROOT);
  const accessFiles = new Map<string, Set<string>>();
  const lowercaseSql: string[] = [];

  for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pluginDirectory = path.join(pluginsRoot, entry.name);
    const manifest = readPluginManifest(pluginDirectory);
    if (!manifest) continue;
    const owned = new Set(manifest.ownedTables.map(table => table.toLowerCase()));

    for (const absolute of listFiles(path.join(pluginDirectory, 'src'))) {
      const relative = path.relative(repoRoot, absolute).split(path.sep).join('/');
      if (!isRuntimeSource(relative)) continue;
      for (const text of extractStringTexts(fs.readFileSync(absolute, 'utf8'), absolute)) {
        if (isLowercaseSql(text)) lowercaseSql.push(relative);
        if (!isSqlText(text)) continue;
        for (const access of findTableAccesses(text)) {
          const lower = access.table.toLowerCase();
          if (owned.has(lower) || (access.mode === 'reference' && HOST_IDENTITY_TABLES.has(lower))) continue;
          const table = access.table === '<dynamic>'
            ? `<dynamic:${path.relative(pluginDirectory, absolute).split(path.sep).join('/')}>`
            : access.table;
          const key = `${manifest.id} ${access.mode} ${table}`;
          const files = accessFiles.get(key) ?? new Set<string>();
          files.add(relative);
          accessFiles.set(key, files);
        }
      }
    }
  }

  return {
    accesses: [...accessFiles.entries()]
      .map(([key, files]) => ({ key, files: [...files].sort() }))
      .sort((left, right) => left.key.localeCompare(right.key)),
    lowercaseSql: [...new Set(lowercaseSql)].sort(),
  };
}

export function compareWithBaseline(current: readonly CrossTableAccess[], baseline: readonly string[]): BaselineDiff {
  const baselineSet = new Set(baseline);
  const currentKeys = new Set(current.map(access => access.key));
  return {
    added: current.filter(access => !baselineSet.has(access.key)),
    removed: baseline.filter(key => !currentKeys.has(key)).sort(),
  };
}

export function readBaseline(content: string): string[] {
  const entries = content
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
  const duplicates = entries.filter((entry, index) => entries.indexOf(entry) !== index);
  if (duplicates.length > 0) throw new Error(`baseline 存在重复条目：${[...new Set(duplicates)].join(', ')}`);
  for (const entry of entries) {
    if (!/^\S+ (?:read|write|schema|reference) \S+$/.test(entry)) throw new Error(`baseline 条目格式不对：${entry}`);
  }
  return entries.sort();
}

export function runPluginTableOwnershipRatchet(repoRoot = REPO_ROOT): BaselineDiff & { readonly lowercaseSql: readonly string[] } {
  const scan = scanPluginTableAccess(repoRoot);
  const baseline = readBaseline(fs.readFileSync(path.join(repoRoot, BASELINE_PATH), 'utf8'));
  return { ...compareWithBaseline(scan.accesses, baseline), lowercaseSql: scan.lowercaseSql };
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
  const result = runPluginTableOwnershipRatchet();

  if (result.lowercaseSql.length > 0) {
    console.error('✗ 插件源码里有小写关键字的 SQL，表归属守卫无法识别：');
    for (const file of result.lowercaseSql) console.error(`  ${file}`);
    console.error('\n请把 SQL 关键字改成大写。');
    process.exitCode = 1;
    return;
  }

  if (result.added.length > 0) {
    console.error('✗ 插件新增了跨表访问（只能直接读写 plugin.json ownedTables 里的自有表）：');
    for (const access of result.added) console.error(`  + ${access.key}\n      ${access.files.join('\n      ')}`);
    console.error('\nHost 或其他插件的数据请走 Host 端口。确需新增时手工写入 ' + BASELINE_PATH + '，并在提交说明里写明理由。');
    process.exitCode = 1;
    return;
  }

  if (result.removed.length === 0) {
    console.log('✓ Plugin table ownership ratchet: baseline exact');
    return;
  }

  if (!args.has('--update-baseline')) {
    console.error('✗ 跨表访问已经减少，但 baseline 仍保留这些条目：');
    for (const key of result.removed) console.error(`  - ${key}`);
    console.error('\n请运行 pnpm run guard:plugin-table-ownership:update 收紧 baseline。');
    process.exitCode = 1;
    return;
  }

  const removed = new Set(result.removed);
  const baseline = readBaseline(fs.readFileSync(path.join(REPO_ROOT, BASELINE_PATH), 'utf8'));
  writeBaseline(baseline.filter(key => !removed.has(key)));
  if (args.has('--stage-baseline')) stageBaseline();
  console.log(`✓ Plugin table ownership baseline 收紧 ${result.removed.length} 项`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
