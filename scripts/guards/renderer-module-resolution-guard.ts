import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RENDERER_MODULE_RESOLUTION_CATALOG,
} from '../build/renderer-module-resolution/definitions/rendererModuleResolutionCatalog.js';
import {
  projectRendererTsconfigPaths,
} from '../build/renderer-module-resolution/functions/projectRendererTsconfigPaths.js';
import {
  renderRendererTsconfigPaths,
} from '../build/renderer-module-resolution/functions/renderRendererTsconfigPaths.js';
import {
  validateRendererModuleBoundaries,
} from '../build/renderer-module-resolution/functions/validateRendererModuleBoundaries.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rendererRoot = path.join(repositoryRoot, 'apps/renderer');
const generatedPathsFile = path.join(rendererRoot, 'tsconfig.paths.generated.json');
const productionSourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue']);
const ignoredSourceMarkers = ['/__tests__/', '.test.', '.spec.', '.bench.'];
const forbiddenProductionImports = [
  '@linnya/plugin-host-contract/backend',
  '@plugin/backend',
  'src/electron-main',
  'src/tools',
  'src/app-hosts',
] as const;

const failures: string[] = [];

for (const issue of validateRendererModuleBoundaries(RENDERER_MODULE_RESOLUTION_CATALOG)) {
  failures.push(issue.message);
}

await validateCatalogTargets();
await validateGeneratedPaths();
await validateConfigOwnership();
await validateRendererUiEntries();
await validateProductionImports();

if (failures.length > 0) {
  console.error('Renderer module-resolution guard 失败：');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Renderer module-resolution guard 通过（${RENDERER_MODULE_RESOLUTION_CATALOG.length} 个目录项）。`);
}

async function validateCatalogTargets(): Promise<void> {
  for (const entry of RENDERER_MODULE_RESOLUTION_CATALOG) {
    const target = path.resolve(repositoryRoot, entry.canonicalTarget);
    try {
      await access(target);
    } catch {
      failures.push(`目录目标不存在：${entry.specifier} (${entry.match}) -> ${entry.canonicalTarget}`);
    }
  }
}

async function validateGeneratedPaths(): Promise<void> {
  const expected = renderRendererTsconfigPaths(projectRendererTsconfigPaths(
    RENDERER_MODULE_RESOLUTION_CATALOG,
    repositoryRoot,
    rendererRoot,
  ));
  const actual = await readFile(generatedPathsFile, 'utf8');
  if (actual !== expected) {
    failures.push('apps/renderer/tsconfig.paths.generated.json 已漂移；请运行 pnpm generate:renderer-module-resolution');
  }
}

async function validateConfigOwnership(): Promise<void> {
  const rendererTsconfig = await readFile(path.join(rendererRoot, 'tsconfig.json'), 'utf8');
  if (rendererTsconfig.includes('"paths"')) {
    failures.push('apps/renderer/tsconfig.json 不得手写 compilerOptions.paths');
  }
  if (!rendererTsconfig.includes('tsconfig.paths.generated.json')) {
    failures.push('apps/renderer/tsconfig.json 未消费 generated paths profile');
  }

  const viteConfig = await readFile(path.join(repositoryRoot, 'vite.config.mjs'), 'utf8');
  if (!viteConfig.includes('projectRendererViteAliases')) {
    failures.push('vite.config.mjs 未从 Renderer catalog 投影 alias');
  }

  const vitestConfig = await readFile(path.join(repositoryRoot, 'vitest.renderer.config.ts'), 'utf8');
  if (!vitestConfig.includes('projectRendererViteAliases')) {
    failures.push('vitest.renderer.config.ts 未从 Renderer catalog 投影 alias');
  }
  const defaultVitestConfig = await readFile(path.join(repositoryRoot, 'vitest.config.ts'), 'utf8');
  if (!defaultVitestConfig.includes('projectRendererViteAliases')) {
    failures.push('vitest.config.ts 未为跨 Host/Renderer 集成测试复用 Renderer catalog');
  }
}

async function validateRendererUiEntries(): Promise<void> {
  const rendererUiPackage = await readJsonObject(path.join(repositoryRoot, 'packages/renderer-ui/package.json'));
  const exportsValue = rendererUiPackage.exports;
  if (!isRecord(exportsValue)) {
    failures.push('@linnya/renderer-ui package.json 缺少对象形式 exports');
    return;
  }

  const packageJsSpecifiers = Object.entries(exportsValue)
    .filter(([exportKey, target]) => (
      exportKey !== './package.json'
      && typeof target === 'string'
      && !target.endsWith('.css')
    ))
    .map(([exportKey]) => exportKey === '.'
      ? '@linnya/renderer-ui'
      : `@linnya/renderer-ui/${exportKey.slice(2)}`)
    .toSorted();
  const catalogSpecifiers = RENDERER_MODULE_RESOLUTION_CATALOG
    .filter(entry => entry.match === 'exact' && (
      entry.specifier === '@linnya/renderer-ui'
      || entry.specifier.startsWith('@linnya/renderer-ui/')
    ))
    .map(entry => entry.specifier)
    .toSorted();

  if (JSON.stringify(packageJsSpecifiers) !== JSON.stringify(catalogSpecifiers)) {
    failures.push(`Renderer UI JS exports 与 catalog 不一致：package=${packageJsSpecifiers.join(', ')} catalog=${catalogSpecifiers.join(', ')}`);
  }

  for (const cssEntry of ['./tokens.css', './styles.css'] as const) {
    if (typeof exportsValue[cssEntry] !== 'string') {
      failures.push(`Renderer UI 缺少 CSS export：${cssEntry}`);
    }
    const cssSpecifier = `@linnya/renderer-ui/${cssEntry.slice(2)}`;
    if (catalogSpecifiers.includes(cssSpecifier)) {
      failures.push(`CSS-only 入口不得进入 TypeScript/runtime JS catalog：${cssSpecifier}`);
    }
  }
}

async function validateProductionImports(): Promise<void> {
  const sourceFiles = await collectFiles(rendererRoot);
  const importPattern = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/gu;

  for (const filePath of sourceFiles) {
    const normalizedPath = filePath.replaceAll(path.sep, '/');
    if (ignoredSourceMarkers.some(marker => normalizedPath.includes(marker))) continue;

    const source = await readFile(filePath, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier) continue;
      const forbidden = forbiddenProductionImports.find(prefix => (
        specifier === prefix || specifier.startsWith(`${prefix}/`)
      ));
      if (forbidden) {
        failures.push(`生产 Renderer 禁止导入 ${specifier}：${path.relative(repositoryRoot, filePath)}`);
      }
    }
  }
}

async function collectFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'react-ref') continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath));
    } else if (productionSourceExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
  if (!isRecord(parsed)) throw new Error(`${filePath} 不是 JSON object`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
