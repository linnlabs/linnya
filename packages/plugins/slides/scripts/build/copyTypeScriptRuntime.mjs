import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);

export const SLIDES_TYPESCRIPT_STANDARD_LIB_ROOTS = Object.freeze(['lib.es2020.d.ts']);

const TYPESCRIPT_RUNTIME_FILES = Object.freeze(['LICENSE.txt', 'ThirdPartyNoticeText.txt']);

const LIB_REFERENCE_PATTERN = /<reference\s+lib=["']([^"']+)["'][^>]*>/gu;
const LIB_FILE_NAME_PATTERN = /^lib\.[a-z0-9.-]+\.d\.ts$/u;

export async function copySlidesTypeScriptRuntime(options = {}) {
  const targetDir = options.targetDir ?? 'dist/backend/node_modules/typescript';
  const sourceLibDir = path.dirname(require.resolve('typescript'));
  const sourcePackageDir = path.dirname(sourceLibDir);
  const packageJson = JSON.parse(
    await readFile(path.join(sourcePackageDir, 'package.json'), 'utf8')
  );
  const standardLibFiles = await collectTypeScriptStandardLibClosure({
    libDir: sourceLibDir,
    roots: SLIDES_TYPESCRIPT_STANDARD_LIB_ROOTS,
  });

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.join(targetDir, 'lib'), { recursive: true });
  await copyFile(
    path.join(sourceLibDir, 'typescript.js'),
    path.join(targetDir, 'lib', 'typescript.js')
  );
  for (const fileName of standardLibFiles) {
    await copyFile(path.join(sourceLibDir, fileName), path.join(targetDir, 'lib', fileName));
  }
  for (const fileName of TYPESCRIPT_RUNTIME_FILES) {
    await copyFile(path.join(sourcePackageDir, fileName), path.join(targetDir, fileName));
  }

  const runtimePackageJson = {
    name: 'typescript',
    version: packageJson.version,
    private: true,
    license: packageJson.license,
    main: './lib/typescript.js',
  };
  await writeFile(
    path.join(targetDir, 'package.json'),
    `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
    'utf8'
  );
  await writeFile(
    path.join(targetDir, 'runtime-manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        packageVersion: packageJson.version,
        standardLibRoots: SLIDES_TYPESCRIPT_STANDARD_LIB_ROOTS,
        standardLibFiles,
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return {
    packageVersion: packageJson.version,
    standardLibFiles,
  };
}

/** 根据 TypeScript 自己的 `reference lib` 关系计算运行时真实闭包。 */
export async function collectTypeScriptStandardLibClosure({ libDir, roots }) {
  const visited = new Set();

  async function visit(fileName) {
    assertTypeScriptLibFileName(fileName);
    if (visited.has(fileName)) return;

    const filePath = path.join(libDir, fileName);
    const fileStats = await stat(filePath).catch(() => null);
    if (!fileStats?.isFile()) {
      throw new Error(`TypeScript standard lib reference is missing: ${fileName}`);
    }
    visited.add(fileName);

    const source = await readFile(filePath, 'utf8');
    for (const match of source.matchAll(LIB_REFERENCE_PATTERN)) {
      const libName = match[1]?.trim().toLowerCase();
      if (!libName) {
        throw new Error(`TypeScript standard lib contains an empty reference: ${fileName}`);
      }
      await visit(`lib.${libName}.d.ts`);
    }
  }

  for (const root of roots) {
    await visit(root);
  }
  return [...visited].sort((left, right) => left.localeCompare(right));
}

function assertTypeScriptLibFileName(fileName) {
  if (!LIB_FILE_NAME_PATTERN.test(fileName) || path.basename(fileName) !== fileName) {
    throw new Error(`Invalid TypeScript standard lib filename: ${fileName}`);
  }
}
