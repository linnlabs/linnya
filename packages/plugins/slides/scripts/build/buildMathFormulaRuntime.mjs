import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  isBundleTraceEnabled,
  writeEsbuildBundleTrace,
} from '../../../../../scripts/build/bundle-trace/functions/bundleBuildTrace.mjs';

export const SLIDES_MATHJAX_RUNTIME_PACKAGE = '@linnya/slides-mathjax-runtime';

const MAX_RUNTIME_BYTES = 3 * 1024 * 1024;
const runtimeRelativeDir = 'dist/backend/node_modules/@linnya/slides-mathjax-runtime';
const cliBridgeRelativeDir = 'dist/cli/node_modules/@linnya/slides-mathjax-runtime';
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageDir, '../../..');
const require = createRequire(import.meta.url);
const esbuildVersion = require('esbuild/package.json').version;

/**
 * MathJax/STIX2 是 preview 与 CLI 共用的同一排版 runtime。把它生成为一个窄的
 * 私有 package，可以避免 backend、build Worker 和 standalone CLI 各打包一份字形表。
 */
export async function buildSlidesMathFormulaRuntime() {
  const runtimeDir = path.resolve(runtimeRelativeDir);
  const entryPath = path.resolve(
    'src/backend/engine/mathFormula/runtime/mathJaxSvgRuntime.ts',
  );
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(runtimeDir, { recursive: true });
  const buildResult = await build({
    entryPoints: [entryPath],
    outfile: path.join(runtimeDir, 'index.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    tsconfig: path.resolve('tsconfig.json'),
    minifySyntax: true,
    minifyWhitespace: true,
    legalComments: 'none',
    logLevel: 'silent',
    metafile: isBundleTraceEnabled(),
  });
  if (buildResult.metafile) {
    writeEsbuildBundleTrace({
      buildTarget: 'plugin-slides/math-formula-runtime',
      metafile: buildResult.metafile,
      repositoryRoot,
      toolVersion: esbuildVersion,
      workingDirectory: process.cwd(),
    });
  }

  const [mathJaxPackage, stixPackage] = await Promise.all([
    readPackageJson('node_modules/@mathjax/src/package.json'),
    readPackageJson('node_modules/@mathjax/mathjax-stix2-font/package.json'),
  ]);
  await Promise.all([
    writeJson(path.join(runtimeDir, 'package.json'), {
      name: SLIDES_MATHJAX_RUNTIME_PACKAGE,
      private: true,
      main: './index.cjs',
      license: 'Apache-2.0',
    }),
    writeJson(path.join(runtimeDir, 'runtime-manifest.json'), {
      schemaVersion: 1,
      mathJaxVersion: mathJaxPackage.version,
      stix2Version: stixPackage.version,
    }),
  ]);

  const runtimeStats = await stat(path.join(runtimeDir, 'index.cjs'));
  if (runtimeStats.size > MAX_RUNTIME_BYTES) {
    throw new Error(
      `Slides MathJax runtime is ${formatMiB(runtimeStats.size)}, exceeding the ${formatMiB(MAX_RUNTIME_BYTES)} budget.`,
    );
  }
  return { runtimeDir, runtimeBytes: runtimeStats.size };
}

/** CLI 只登记到 backend 中的同一 runtime，不能再复制一份 MathJax 字形数据。 */
export async function writeSlidesMathFormulaCliRuntimeBridge() {
  const bridgeDir = path.resolve(cliBridgeRelativeDir);
  await rm(bridgeDir, { recursive: true, force: true });
  await mkdir(bridgeDir, { recursive: true });
  await Promise.all([
    writeJson(path.join(bridgeDir, 'package.json'), {
      name: SLIDES_MATHJAX_RUNTIME_PACKAGE,
      private: true,
      main: './index.cjs',
    }),
    writeFile(
      path.join(bridgeDir, 'index.cjs'),
      `'use strict';\nmodule.exports = require('../../../../backend/node_modules/@linnya/slides-mathjax-runtime');\n`,
      'utf8',
    ),
  ]);
}

async function readPackageJson(relativePath) {
  return JSON.parse(await readFile(path.resolve(relativePath), 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
