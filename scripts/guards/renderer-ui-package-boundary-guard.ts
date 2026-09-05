import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RENDERER_UI_HOST_CONSUMER_ROOTS,
  RENDERER_UI_PLUGIN_WORKSPACE_ROOT,
  RENDERER_UI_PUBLIC_TOKEN_ALLOWLIST,
} from './definitions/rendererUiBoundaryCatalog.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rendererUiRoot = path.join(repositoryRoot, 'packages/renderer-ui');
const rendererUiFontStackRoot = path.join(rendererUiRoot, 'src/features/font-stack');
const rendererUiSourceRoot = path.join(rendererUiRoot, 'src');
const sourceExtensions = new Set(['.css', '.js', '.jsx', '.ts', '.tsx', '.vue']);
const ignoredMarkers = ['/__tests__/', '/__test__/', '.test.', '.spec.', '.bench.', '/dist/'];
const packageForbiddenImportPrefixes = [
  '@/app/',
  '@/domains/',
  '@/shared/',
  '@app/',
  '@shared/',
  '@plugin/',
  'apps/renderer/',
  'src/plugin-sdk/',
  'src/electron-main/',
] as const;

const failures: string[] = [];
const consumerFiles = await collectConsumerFiles();
const packageStyleFacts = await readPackageStyleFacts();
const publicPackageSpecifiers = await readPublicPackageSpecifiers();
const currentLegacyImports = collectLegacyImports(consumerFiles);

for (const legacyImport of currentLegacyImports) {
  failures.push(
    `已退役的 Renderer UI 边界不得重新引用：${legacyImport.specifier} @ ${legacyImport.importer}`
  );
}

await validateRendererUiPackageImports();
await validatePureFontStackBoundary();
validateReservedTokenDefinitions(consumerFiles, packageStyleFacts.tokenDefinitions);
validatePluginRendererBoundaries(consumerFiles, publicPackageSpecifiers, packageStyleFacts);

if (failures.length > 0) {
  console.error('Renderer UI package boundary guard 失败：');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Renderer UI package boundary guard 通过（旧 UI 引用已锁零）。');
}

interface AuditedFile {
  readonly path: string;
  readonly source: string;
}

interface LegacyImport {
  readonly importer: string;
  readonly specifier: string;
}

interface PackageStyleFacts {
  readonly classNames: ReadonlySet<string>;
  readonly tokenDefinitions: ReadonlySet<string>;
}

async function collectConsumerFiles(): Promise<readonly AuditedFile[]> {
  const consumerRoots = [
    ...RENDERER_UI_HOST_CONSUMER_ROOTS,
    ...(await discoverPluginRendererRoots()),
  ];
  const files = await Promise.all(
    consumerRoots.map(async root => collectFiles(path.join(repositoryRoot, root)))
  );
  const uniquePaths = Array.from(new Set(files.flat())).toSorted();
  return Promise.all(
    uniquePaths.map(async filePath => ({
      path: normalizePath(path.relative(repositoryRoot, filePath)),
      source: await readFile(filePath, 'utf8'),
    }))
  );
}

async function discoverPluginRendererRoots(): Promise<readonly string[]> {
  const pluginWorkspacePath = path.join(repositoryRoot, RENDERER_UI_PLUGIN_WORKSPACE_ROOT);
  let entries;
  try {
    entries = await readdir(pluginWorkspacePath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => `${RENDERER_UI_PLUGIN_WORKSPACE_ROOT}/${entry.name}/src/renderer`)
    .toSorted();
}

function collectLegacyImports(files: readonly AuditedFile[]): readonly LegacyImport[] {
  const imports: LegacyImport[] = [];
  for (const file of files) {
    for (const specifier of extractImports(file.source)) {
      if (isLegacyUiSpecifier(specifier, file.path))
        imports.push({ importer: file.path, specifier });
    }
  }
  return imports.toSorted(
    (left, right) =>
      left.importer.localeCompare(right.importer) || left.specifier.localeCompare(right.specifier)
  );
}

async function validateRendererUiPackageImports(): Promise<void> {
  const files = await collectFiles(rendererUiRoot);
  for (const filePath of files) {
    if (!sourceExtensions.has(path.extname(filePath))) continue;
    const relativePath = normalizePath(path.relative(repositoryRoot, filePath));
    const source = await readFile(filePath, 'utf8');
    for (const specifier of extractImports(source)) {
      if (specifier.startsWith('.')) {
        const resolvedPath = path.resolve(path.dirname(filePath), specifier);
        const relativeToPackage = path.relative(rendererUiRoot, resolvedPath);
        if (relativeToPackage.startsWith('..') || path.isAbsolute(relativeToPackage)) {
          failures.push(
            `Renderer UI package 相对 import 越出 package：${specifier} @ ${relativePath}`
          );
        }
      }
      const forbidden = packageForbiddenImportPrefixes.find(
        prefix => specifier === prefix.slice(0, -1) || specifier.startsWith(prefix)
      );
      if (forbidden) failures.push(`Renderer UI package 禁止导入 ${specifier}：${relativePath}`);
      if (specifier.startsWith('node:') || specifier === 'electron') {
        failures.push(`Renderer UI package 禁止 Node/Electron 依赖 ${specifier}：${relativePath}`);
      }
    }
  }
}

async function validatePureFontStackBoundary(): Promise<void> {
  const files = await collectFiles(rendererUiFontStackRoot);
  const browserRuntimePattern =
    /\b(?:document|window|navigator|getComputedStyle|HTMLElement|HTMLCanvasElement|CSSStyleDeclaration)\b/u;

  for (const filePath of files) {
    const relativePath = normalizePath(path.relative(repositoryRoot, filePath));
    const source = await readFile(filePath, 'utf8');
    for (const specifier of extractImports(source)) {
      if (!specifier.startsWith('.')) {
        failures.push(`Renderer UI font-stack 纯叶子禁止外部依赖：${specifier} @ ${relativePath}`);
        continue;
      }
      const resolvedPath = path.resolve(path.dirname(filePath), specifier);
      const relativeToLeaf = path.relative(rendererUiFontStackRoot, resolvedPath);
      if (relativeToLeaf.startsWith('..') || path.isAbsolute(relativeToLeaf)) {
        failures.push(
          `Renderer UI font-stack 纯叶子禁止越界 import：${specifier} @ ${relativePath}`
        );
      }
    }
    if (browserRuntimePattern.test(source)) {
      failures.push(`Renderer UI font-stack 纯叶子禁止读取 browser runtime：${relativePath}`);
    }
  }
}

function validateReservedTokenDefinitions(
  files: readonly AuditedFile[],
  packageOwnedTokens: ReadonlySet<string>
): void {
  const publicTokens = new Set<string>([
    ...RENDERER_UI_PUBLIC_TOKEN_ALLOWLIST,
    ...packageOwnedTokens,
  ]);
  const definitionPattern = /(--[a-z][a-z0-9-]*)\s*:/giu;
  for (const file of files) {
    for (const match of file.source.matchAll(definitionPattern)) {
      const token = match[1];
      if (!token || !publicTokens.has(token)) continue;
      if (file.path.startsWith('packages/renderer-ui/')) continue;
      failures.push(`Renderer UI 保留 token 不得由外部重定义：${token} @ ${file.path}`);
    }
  }
}

async function readPackageStyleFacts(): Promise<PackageStyleFacts> {
  // 组件 CSS 按 feature 归属；只扫顶层 src/styles 会漏掉真正的私有 DOM selector。
  const cssFiles = (await collectFiles(rendererUiSourceRoot)).filter(filePath =>
    filePath.endsWith('.css')
  );
  const tokenDefinitions = new Set<string>();
  const classNames = new Set<string>();
  for (const filePath of cssFiles) {
    const source = await readFile(filePath, 'utf8');
    for (const match of source.matchAll(/(--[a-z][a-z0-9-]*)\s*:/giu)) {
      if (match[1]) tokenDefinitions.add(match[1]);
    }
    for (const className of extractCssSelectorClassNames(source)) classNames.add(className);
  }
  return { classNames, tokenDefinitions };
}

async function readPublicPackageSpecifiers(): Promise<ReadonlySet<string>> {
  const parsed: unknown = JSON.parse(
    await readFile(path.join(rendererUiRoot, 'package.json'), 'utf8')
  );
  if (!isRecord(parsed) || !isRecord(parsed.exports)) {
    throw new Error('@linnya/renderer-ui package.json 缺少 exports object');
  }
  return new Set(
    Object.keys(parsed.exports).map(exportKey =>
      exportKey === '.' ? '@linnya/renderer-ui' : `@linnya/renderer-ui/${exportKey.slice(2)}`
    )
  );
}

function validatePluginRendererBoundaries(
  files: readonly AuditedFile[],
  publicPackageSpecifiers: ReadonlySet<string>,
  packageStyleFacts: PackageStyleFacts
): void {
  for (const file of files) {
    const pluginMatch = file.path.match(/^packages\/plugins\/([^/]+)\/src\/renderer\//u);
    if (!pluginMatch?.[1]) continue;

    for (const specifier of extractImports(file.source)) {
      if (
        specifier.startsWith('apps/renderer/') ||
        specifier.startsWith('@/domains/') ||
        specifier.startsWith('@/shared/') ||
        specifier.startsWith('@shared/')
      ) {
        failures.push(`Renderer plugin 禁止依赖 Host 内部路径：${specifier} @ ${file.path}`);
      }
      if (specifier.startsWith('@linnya/renderer-ui/') && !publicPackageSpecifiers.has(specifier)) {
        failures.push(`Renderer plugin 禁止 Renderer UI deep import：${specifier} @ ${file.path}`);
      }
      if (
        specifier === '@linnya/renderer-ui/styles.css' ||
        specifier === '@linnya/renderer-ui/tokens.css'
      ) {
        failures.push(`Renderer plugin 禁止重复装载 Renderer UI CSS：${specifier} @ ${file.path}`);
      }
    }

    if (!file.path.endsWith('.css')) continue;
    if (
      /\.(?:dark-mode|moon-blue-mode)\b/u.test(file.source) ||
      file.source.includes('[data-linnya-ui-theme=')
    ) {
      failures.push(`Renderer plugin 禁止按 Host theme selector 分支：${file.path}`);
    }
    for (const match of file.source.matchAll(/(--[a-z][a-z0-9-]*)\s*:/giu)) {
      if (match[1] && packageStyleFacts.tokenDefinitions.has(match[1])) {
        failures.push(`Renderer plugin 禁止重定义 package token：${match[1]} @ ${file.path}`);
      }
    }
    for (const className of extractCssSelectorClassNames(file.source)) {
      if (packageStyleFacts.classNames.has(className)) {
        failures.push(`Renderer plugin 禁止覆盖 package 内部 class：.${className} @ ${file.path}`);
      }
    }
  }
}

function extractCssSelectorClassNames(source: string): ReadonlySet<string> {
  const classNames = new Set<string>();
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//gu, '');
  for (const ruleMatch of withoutComments.matchAll(/(?:^|\})\s*([^@}\n][^{]+)\{/gmu)) {
    const selector = ruleMatch[1];
    if (!selector) continue;
    for (const classMatch of selector.matchAll(/\.([a-z_][a-z0-9_-]*)/giu)) {
      if (classMatch[1]) classNames.add(classMatch[1]);
    }
  }
  return classNames;
}

function extractImports(source: string): readonly string[] {
  const pattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|import\s*\()\s*['"]([^'"]+)['"]/gu;
  return Array.from(source.matchAll(pattern), match => match[1]).filter(
    (value): value is string => typeof value === 'string'
  );
}

async function collectFiles(directory: string): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const normalizedPath = normalizePath(entryPath);
    if (ignoredMarkers.some(marker => normalizedPath.includes(marker))) continue;
    if (entry.name === 'node_modules' || entry.name === 'react-ref') continue;
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(entryPath);
  }
  return files;
}

function isLegacyUiSpecifier(specifier: string, importer: string): boolean {
  if (specifier.startsWith('.')) {
    const resolved = normalizePath(
      path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier))
    );
    if (
      resolved.startsWith('apps/renderer/shared/components/') ||
      resolved.startsWith('apps/renderer/shared/styles/') ||
      resolved.startsWith('apps/renderer/shared/scroll/')
    ) {
      return true;
    }
  }

  return (
    matchesLegacyPath(specifier, '@shared/components') ||
    matchesLegacyPath(specifier, '@/shared/components') ||
    matchesLegacyPath(specifier, '@shared/styles') ||
    matchesLegacyPath(specifier, '@/shared/styles') ||
    matchesLegacyPath(specifier, 'apps/renderer/shared/components') ||
    matchesLegacyPath(specifier, 'apps/renderer/shared/styles') ||
    matchesLegacyPath(specifier, 'apps/renderer/shared/scroll') ||
    specifier === '@shared/scroll' ||
    specifier === '@/shared/scroll' ||
    specifier === '@plugin/renderer/toolUi' ||
    specifier === '@plugin/renderer/scroll'
  );
}

function matchesLegacyPath(specifier: string, legacyPath: string): boolean {
  return specifier === legacyPath || specifier.startsWith(`${legacyPath}/`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, '/');
}
