/**
 * Conversation 历史类型出口棘轮（R-13）。
 *
 * `types/index.ts` 是待拆除的过宽出口：现有符号可以随 feature 迁移而减少，
 * 但新合同必须直接归属 domain/feature definitions，不能继续扩张这里。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const REPO_ROOT = process.cwd();
const TYPES_ENTRY_PATH = 'apps/renderer/domains/conversation/types/index.ts';
const BASELINE_PATH = '.baseline/conversation-types-exports.txt';

const BASELINE_HEADER = [
  '# Conversation legacy types export surface (R-13)',
  '# 只允许删除。新增类型必须归属对应 domain/feature definitions。',
];

export interface ExportSurfaceDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

function hasDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false);
}

function collectBindingNames(name: ts.BindingName, symbols: Set<string>): void {
  if (ts.isIdentifier(name)) {
    symbols.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    collectBindingNames(element.name, symbols);
  }
}

/** 读取文件真实公开符号；不按 export 行数猜测。 */
export function readExportedSymbols(source: string, fileName = TYPES_ENTRY_PATH): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const symbols = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      throw new Error(`${fileName}: 禁止 default export；历史出口必须保持显式命名`);
    }

    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) {
        throw new Error(`${fileName}: 禁止 export *；棘轮无法审计隐式扩张的公开面`);
      }
      if (!ts.isNamedExports(statement.exportClause)) {
        throw new Error(`${fileName}: 不支持 namespace export；请显式列出公开符号`);
      }
      for (const element of statement.exportClause.elements) {
        symbols.add(element.name.text);
      }
      continue;
    }

    if (!hasExportModifier(statement)) continue;
    if (hasDefaultModifier(statement)) {
      throw new Error(`${fileName}: 禁止 default export；历史出口必须保持显式命名`);
    }

    if (
      ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isFunctionDeclaration(statement)
      || ts.isEnumDeclaration(statement)
      || ts.isModuleDeclaration(statement)
    ) {
      if (!statement.name) {
        throw new Error(`${fileName}: 默认匿名导出不属于允许的历史出口形态`);
      }
      symbols.add(statement.name.text);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, symbols);
      }
      continue;
    }

    throw new Error(`${fileName}: 发现棘轮尚未识别的 export 声明：${statement.getText(sourceFile)}`);
  }

  return [...symbols].sort();
}

export function compareExportSurface(
  current: readonly string[],
  baseline: readonly string[],
): ExportSurfaceDiff {
  const currentSet = new Set(current);
  const baselineSet = new Set(baseline);
  return {
    added: [...currentSet].filter(symbol => !baselineSet.has(symbol)).sort(),
    removed: [...baselineSet].filter(symbol => !currentSet.has(symbol)).sort(),
  };
}

function readBaseline(content: string): string[] {
  const symbols = content
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
  const duplicates = symbols.filter((symbol, index) => symbols.indexOf(symbol) !== index);
  if (duplicates.length > 0) {
    throw new Error(`baseline 存在重复符号：${[...new Set(duplicates)].join(', ')}`);
  }
  return symbols.sort();
}

function writeBaseline(symbols: readonly string[]): void {
  const absolutePath = path.join(REPO_ROOT, BASELINE_PATH);
  fs.writeFileSync(absolutePath, `${[...BASELINE_HEADER, ...[...symbols].sort()].join('\n')}\n`);
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

export function runConversationTypesExportRatchet(): ExportSurfaceDiff {
  const source = fs.readFileSync(path.join(REPO_ROOT, TYPES_ENTRY_PATH), 'utf8');
  const baseline = readBaseline(fs.readFileSync(path.join(REPO_ROOT, BASELINE_PATH), 'utf8'));
  return compareExportSurface(readExportedSymbols(source), baseline);
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const shouldUpdate = args.has('--update-baseline');
  const shouldStage = args.has('--stage-baseline');
  const diff = runConversationTypesExportRatchet();

  if (diff.added.length > 0) {
    console.error('✗ Conversation legacy types 出口新增了公开符号（违反 R-13）');
    for (const symbol of diff.added) console.error(`  + ${symbol}`);
    console.error('\n新类型应放入对应 domain/feature 的 definitions，并通过窄 public contract 导出。');
    process.exitCode = 1;
    return;
  }

  if (diff.removed.length === 0) {
    console.log('✓ Conversation legacy types export ratchet: baseline exact');
    return;
  }

  if (!shouldUpdate) {
    console.error('✗ Conversation legacy types 出口已经收窄，但 baseline 仍包含已删除符号：');
    for (const symbol of diff.removed) console.error(`  - ${symbol}`);
    console.error('\n请运行 pnpm run guard:conversation-types-exports:update 收紧 baseline。');
    process.exitCode = 1;
    return;
  }

  const source = fs.readFileSync(path.join(REPO_ROOT, TYPES_ENTRY_PATH), 'utf8');
  writeBaseline(readExportedSymbols(source));
  if (shouldStage) stageBaseline();
  console.log(`✓ Conversation legacy types export baseline 收紧 ${diff.removed.length} 项`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
