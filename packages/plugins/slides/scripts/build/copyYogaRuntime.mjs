import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);

export const SLIDES_YOGA_RUNTIME_ROOT = 'dist/src/load.js';

const RELATIVE_ESM_IMPORT_PATTERN =
  /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gu;

export async function copySlidesYogaRuntime(options = {}) {
  const targetDir = options.targetDir ?? 'dist/backend/node_modules/yoga-layout';
  const sourceEntryPath = require.resolve('yoga-layout/load');
  const sourcePackageDir = path.resolve(path.dirname(sourceEntryPath), '..', '..');
  const sourcePackage = JSON.parse(
    await readFile(path.join(sourcePackageDir, 'package.json'), 'utf8')
  );
  const moduleFiles = await collectYogaRuntimeModuleClosure({
    packageDir: sourcePackageDir,
    root: SLIDES_YOGA_RUNTIME_ROOT,
  });

  await rm(targetDir, { recursive: true, force: true });
  for (const relativePath of moduleFiles) {
    const targetPath = path.join(targetDir, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(path.join(sourcePackageDir, relativePath), targetPath);
  }

  await mkdir(targetDir, { recursive: true });
  await writeFile(
    path.join(targetDir, 'package.json'),
    `${JSON.stringify({
      name: 'yoga-layout',
      version: sourcePackage.version,
      private: true,
      license: sourcePackage.license,
      type: 'module',
      exports: { './load': `./${SLIDES_YOGA_RUNTIME_ROOT}` },
    }, null, 2)}\n`,
    'utf8'
  );
  await writeFile(
    path.join(targetDir, 'runtime-manifest.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      packageVersion: sourcePackage.version,
      root: SLIDES_YOGA_RUNTIME_ROOT,
      moduleFiles,
    }, null, 2)}\n`,
    'utf8'
  );

  return { packageVersion: sourcePackage.version, moduleFiles };
}

/** 从正式 `load` export 出发，只收集运行时真实引用的 ESM 模块。 */
export async function collectYogaRuntimeModuleClosure({ packageDir, root }) {
  const visited = new Set();

  async function visit(relativePath) {
    const normalizedPath = normalizeRuntimeModulePath(relativePath);
    if (visited.has(normalizedPath)) return;

    const modulePath = path.join(packageDir, normalizedPath);
    const moduleStats = await stat(modulePath).catch(() => null);
    if (!moduleStats?.isFile()) {
      throw new Error(`Yoga runtime module is missing: ${normalizedPath}`);
    }
    visited.add(normalizedPath);

    const source = await readFile(modulePath, 'utf8');
    for (const match of source.matchAll(RELATIVE_ESM_IMPORT_PATTERN)) {
      const specifier = match[1];
      if (!specifier) continue;
      await visit(path.posix.join(path.posix.dirname(normalizedPath), specifier));
    }
  }

  await visit(root);
  return [...visited].sort((left, right) => left.localeCompare(right));
}

function normalizeRuntimeModulePath(relativePath) {
  const normalizedPath = path.posix.normalize(relativePath.replaceAll('\\', '/'));
  if (
    path.posix.isAbsolute(normalizedPath)
    || normalizedPath === '..'
    || normalizedPath.startsWith('../')
    || path.posix.extname(normalizedPath) !== '.js'
  ) {
    throw new Error(`Invalid Yoga runtime module path: ${relativePath}`);
  }
  return normalizedPath;
}
