import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import { parse as parseVueSfc } from 'vue/compiler-sfc';

export type ShellToolBoundaryRuleId =
  | 'SHELL-BOUNDARY-01-no-process-spawn-in-ui-or-tool'
  | 'SHELL-BOUNDARY-02-commands-domain-is-technology-neutral'
  | 'SHELL-BOUNDARY-03-no-platform-adapter-in-renderer'
  | 'SHELL-BOUNDARY-04-no-retired-plugin-command-surface';

export interface ShellToolBoundaryViolation {
  readonly ruleId: ShellToolBoundaryRuleId;
  readonly file: string;
  readonly line: number;
  readonly importPath: string;
  readonly message: string;
}

const REPOSITORY_ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs', '.ts', '.tsx', '.vue']);
const SCAN_ROOTS = [
  'apps/renderer',
  'src',
  'packages/plugin-host-contract',
  'packages/plugins',
  'packages/schemas/src/commands',
] as const;

const RETIRED_PLUGIN_COMMAND_PATTERNS = [
  /\bplugin_command\b/u,
  /\bHostedCommand/u,
  /\bhosted_command/u,
  /\bpluginCommandToolRuntime\b/u,
  /\breserveHosted\b/u,
  /\bclaimAndStartHosted\b/u,
  /\breleaseHosted\b/u,
  /\bBackendPluginCommand/u,
] as const;

function normalize(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isProductionSource(filePath: string): boolean {
  const normalized = normalize(filePath);
  return SOURCE_EXTENSIONS.has(path.extname(normalized))
    && !normalized.includes('/__tests__/')
    && !normalized.includes('/dist/')
    && !normalized.includes('/fixtures/')
    && !/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(normalized);
}

function scriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function sourceSegments(filePath: string, source: string): readonly string[] {
  if (!filePath.endsWith('.vue')) return [source];
  const parsed = parseVueSfc(source, { filename: filePath });
  return [parsed.descriptor.script?.content, parsed.descriptor.scriptSetup?.content]
    .filter((candidate): candidate is string => candidate !== undefined);
}

function readImportPath(node: ts.CallExpression): string | undefined {
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
  if (!isDynamicImport && !isRequire) return undefined;
  const argument = node.arguments[0];
  return argument && ts.isStringLiteralLike(argument) ? argument.text : undefined;
}

function importedModules(filePath: string, source: string): ReadonlyArray<{
  readonly importPath: string;
  readonly line: number;
}> {
  const imports: Array<{ readonly importPath: string; readonly line: number }> = [];
  for (const segment of sourceSegments(filePath, source)) {
    const sourceFile = ts.createSourceFile(
      filePath,
      segment,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(filePath),
    );
    const visit = (node: ts.Node): void => {
      let moduleSpecifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        moduleSpecifier = node.moduleSpecifier;
      } else if (
        ts.isImportEqualsDeclaration(node)
        && ts.isExternalModuleReference(node.moduleReference)
      ) {
        moduleSpecifier = node.moduleReference.expression;
      }
      const importPath = moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier)
        ? moduleSpecifier.text
        : ts.isCallExpression(node)
          ? readImportPath(node)
          : undefined;
      if (importPath) {
        imports.push({
          importPath,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return imports;
}

function isRenderer(filePath: string): boolean {
  return normalize(filePath).startsWith('apps/renderer/');
}

function isShellOrProcessTool(filePath: string): boolean {
  const normalized = normalize(filePath);
  return normalized.startsWith('src/tools/commands/shell/')
    || normalized.startsWith('src/tools/commands/process/');
}

function isCommandsDomain(filePath: string): boolean {
  return normalize(filePath).startsWith('src/domains/commands/');
}

function isChildProcess(importPath: string): boolean {
  return importPath === 'child_process' || importPath === 'node:child_process';
}

function isElectronTechnology(importPath: string): boolean {
  return importPath === 'electron'
    || importPath.startsWith('electron/')
    || importPath.includes('src/electron-main/')
    || importPath.includes('/electron-main/');
}

function isWorkspaceSqlite(importPath: string): boolean {
  const normalized = importPath.replaceAll('\\', '/');
  return normalized.includes('features/workspace/infrastructure/sqlite');
}

function isCommandPlatformAdapter(importPath: string): boolean {
  const normalized = importPath.replaceAll('\\', '/');
  return normalized.includes('infra/adapters/command-runtime/macos')
    || normalized.includes('infra/adapters/command-runtime/windows');
}

export function analyzeShellToolBoundarySource(
  filePath: string,
  source: string,
): readonly ShellToolBoundaryViolation[] {
  const violations: ShellToolBoundaryViolation[] = [];
  for (const imported of importedModules(filePath, source)) {
    if (
      (isRenderer(filePath) || isShellOrProcessTool(filePath))
      && isChildProcess(imported.importPath)
    ) {
      violations.push({
        ruleId: 'SHELL-BOUNDARY-01-no-process-spawn-in-ui-or-tool',
        file: filePath,
        line: imported.line,
        importPath: imported.importPath,
        message: 'renderer 与 shell/process tool 只能调用公开 runtime port，不能直接创建进程。',
      });
    }
    if (
      isCommandsDomain(filePath)
      && (isElectronTechnology(imported.importPath) || isWorkspaceSqlite(imported.importPath))
    ) {
      violations.push({
        ruleId: 'SHELL-BOUNDARY-02-commands-domain-is-technology-neutral',
        file: filePath,
        line: imported.line,
        importPath: imported.importPath,
        message: 'Commands domain 只能依赖公开 port/contract，不能依赖 Electron 或 Workspace SQLite。',
      });
    }
    if (isRenderer(filePath) && isCommandPlatformAdapter(imported.importPath)) {
      violations.push({
        ruleId: 'SHELL-BOUNDARY-03-no-platform-adapter-in-renderer',
        file: filePath,
        line: imported.line,
        importPath: imported.importPath,
        message: 'renderer 只能经过 preload/IPC 使用命令能力，不能导入平台 adapter。',
      });
    }
  }
  for (const pattern of RETIRED_PLUGIN_COMMAND_PATTERNS) {
    const match = pattern.exec(source);
    if (!match || match.index === undefined) continue;
    const line = source.slice(0, match.index).split(/\r?\n/u).length;
    violations.push({
      ruleId: 'SHELL-BOUNDARY-04-no-retired-plugin-command-surface',
      file: filePath,
      line,
      importPath: match[0],
      message: '旧 plugin_command / Hosted Command 已退出生产合同；插件 CLI 必须经现有 Shell 与父 execution bridge。',
    });
  }
  return violations;
}

function collectFiles(root: string): readonly string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (isProductionSource(target)) files.push(target);
    }
  };
  walk(root);
  return files;
}

export function collectShellToolBoundaryViolations(
  repositoryRoot = REPOSITORY_ROOT,
): readonly ShellToolBoundaryViolation[] {
  const violations: ShellToolBoundaryViolation[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const absolutePath of collectFiles(path.join(repositoryRoot, scanRoot))) {
      const relativePath = normalize(path.relative(repositoryRoot, absolutePath));
      violations.push(...analyzeShellToolBoundarySource(
        relativePath,
        fs.readFileSync(absolutePath, 'utf8'),
      ));
    }
  }
  return violations;
}

function run(): void {
  const violations = collectShellToolBoundaryViolations();
  if (violations.length === 0) {
    process.stdout.write('[shell-tool-boundary-guard] 通过：命令执行高价值依赖边界无旁路。\n');
    return;
  }
  process.stderr.write('[shell-tool-boundary-guard] 检测到命令执行边界旁路：\n');
  for (const violation of violations) {
    process.stderr.write(
      `- ${violation.file}:${violation.line} [${violation.ruleId}] ${violation.importPath}\n`
      + `  ${violation.message}\n`,
    );
  }
  process.exitCode = 1;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(path.resolve(entryPath)).href) run();
