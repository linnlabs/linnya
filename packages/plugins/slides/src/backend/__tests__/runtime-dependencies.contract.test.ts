import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import slidesPackageJson from '../../../package.json';

const slidesPackageDir = path.resolve(import.meta.dirname, '../../..');

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

// Host peers、插件公开别名和 artifact 内生成的私有 runtime 都不属于普通 dependencies；
// 它们仍需显式列出，避免把真正漏声明的第三方依赖误判为已提供。
const slidesRuntimePackagesProvidedOutsideDependencies = new Set([
  '@app/localization',
  '@app/schemas',
  '@linnya/renderer-ui',
  '@linnya/slides-mathjax-runtime',
  '@plugin/backend',
  '@plugin/renderer',
  '@plugin/slides',
  'better-sqlite3',
  'electron',
  'pinia',
  'vue',
]);

const importLikePattern =
  /\bimport\s+(?!type\b)(?:[^'";]*?\s+from\s+)?['"]([^'".][^'"]*)['"]|\bexport\s+(?:[^'";]*?\s+from\s+)['"]([^'".][^'"]*)['"]|\bimport\(\s*['"]([^'".][^'"]*)['"]\s*\)|\brequire\(\s*['"]([^'".][^'"]*)['"]\s*\)/g;

function listProductionSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      files.push(...listProductionSourceFiles(entryPath));
      continue;
    }

    if (
      entry.isFile() &&
      /\.(?:ts|tsx|vue|js|mjs)$/.test(entry.name) &&
      !/\.(?:test|spec)\./.test(entry.name)
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

function readPackageName(moduleSpecifier: string): string | null {
  if (moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')) return null;
  if (nodeBuiltins.has(moduleSpecifier)) return null;
  if (moduleSpecifier.startsWith('@')) {
    const [scope, name] = moduleSpecifier.split('/');
    if (!scope || !name) return moduleSpecifier;
    return `${scope}/${name}`;
  }
  return moduleSpecifier.split('/')[0] ?? moduleSpecifier;
}

function removeJavaScriptComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function listBareRuntimeImports(sourceFile: string): string[] {
  const source = removeJavaScriptComments(fs.readFileSync(sourceFile, 'utf8'));
  const imports: string[] = [];
  let match: RegExpExecArray | null = importLikePattern.exec(source);

  while (match) {
    const moduleSpecifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    const packageName = moduleSpecifier ? readPackageName(moduleSpecifier) : null;
    if (packageName) {
      imports.push(packageName);
    }
    match = importLikePattern.exec(source);
  }

  return imports;
}

describe('Slides runtime dependency contract', () => {
  it('declares every bundled Slides runtime dependency in the Slides package manifest', () => {
    const packageDependencies = new Set(Object.keys(slidesPackageJson.dependencies ?? {}));
    const missingDependencies = new Set<string>();

    for (const sourceFile of listProductionSourceFiles(path.join(slidesPackageDir, 'src'))) {
      for (const packageName of listBareRuntimeImports(sourceFile)) {
        if (slidesRuntimePackagesProvidedOutsideDependencies.has(packageName)) continue;
        if (!packageDependencies.has(packageName)) {
          missingDependencies.add(packageName);
        }
      }
    }

    expect([...missingDependencies].sort()).toEqual([]);
  });

});
