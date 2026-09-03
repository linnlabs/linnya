import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';

import {
  collectTypeScriptStandardLibClosure,
  SLIDES_TYPESCRIPT_STANDARD_LIB_ROOTS,
} from './build/copyTypeScriptRuntime.mjs';

const MAX_BACKEND_ENTRY_BYTES = 4 * 1024 * 1024;
// TypeScript/Yoga、PptxGenJS/JSZip 与原生公式装配均归同一 build Worker；1.6 MiB
// 只保留小幅依赖漂移空间，防止 parser、Host SDK 或完整 backend 被意外卷入。
const MAX_PRESENTATION_BUILD_WORKER_BYTES = 1.6 * 1024 * 1024;
// TypeScript compiler约 9.7 MiB；MathJax/STIX2 作为 backend、build Worker 与 CLI
// 共用的单一自包含 runtime 约 1.8 MiB。16 MiB 是当前两类明确运行时加入口制品后的总门禁，
// 不能通过再次内联 MathJax、复制 runtime 或顺带打入新依赖来消耗。
const MAX_BACKEND_DIRECTORY_BYTES = 16 * 1024 * 1024;
const TYPESCRIPT_INPUT_PATTERN =
  /node_modules\/(?:\.pnpm\/typescript@[^/]+\/node_modules\/)?typescript\//u;
const TYPESCRIPT_RUNTIME_RELATIVE_DIR = 'node_modules/typescript';

/** Backend 门禁同时约束启动入口依赖图和完整自包含 runtime，而不是只看 zip。 */
export async function verifySlidesBackendBundle({ backendDir, bundlePath, metafilePath }) {
  const presentationBuildWorkerPath = path.join(backendDir, 'presentation-build-worker.cjs');
  const [bundleStats, bundleSource, workerStats, rawMetafile] = await Promise.all([
    stat(bundlePath),
    readFile(bundlePath, 'utf8'),
    stat(presentationBuildWorkerPath),
    readFile(metafilePath, 'utf8'),
  ]);
  if (bundleStats.size > MAX_BACKEND_ENTRY_BYTES) {
    throw new Error(
      `Slides backend entry is ${formatMiB(bundleStats.size)}, exceeding the ${formatMiB(MAX_BACKEND_ENTRY_BYTES)} budget.`
    );
  }
  if (workerStats.size > MAX_PRESENTATION_BUILD_WORKER_BYTES) {
    throw new Error(
      `Slides presentation build worker is ${formatMiB(workerStats.size)}, exceeding the ${formatMiB(MAX_PRESENTATION_BUILD_WORKER_BYTES)} budget.`
    );
  }

  const metafile = JSON.parse(rawMetafile);
  const entryOutput = findEntryOutput(metafile.outputs, bundlePath);
  const inputPaths = Object.keys(entryOutput.inputs ?? {}).map(normalizePath);
  if (inputPaths.some(inputPath => TYPESCRIPT_INPUT_PATTERN.test(inputPath))) {
    throw new Error('Slides backend entry eagerly bundles the TypeScript compiler.');
  }

  const runtimeDir = path.join(backendDir, TYPESCRIPT_RUNTIME_RELATIVE_DIR);
  const runtimeSummary = await verifyPackagedTypeScriptRuntime(runtimeDir);
  verifyNoVmIncompatibleNodeImports(bundleSource);
  verifyPptxGenVmRuntime();
  verifyLazyBackendRuntime(bundlePath);
  verifyPresentationBuildWorkerRuntime(presentationBuildWorkerPath);
  const backendBytes = await measureDirectoryBytes(
    backendDir,
    new Set([normalizePath(path.resolve(metafilePath))])
  );
  if (backendBytes > MAX_BACKEND_DIRECTORY_BYTES) {
    throw new Error(
      `Slides backend directory is ${formatMiB(backendBytes)}, exceeding the ${formatMiB(MAX_BACKEND_DIRECTORY_BYTES)} budget.`
    );
  }

  process.stdout.write(
    `[slides-backend] bundle guard passed: entry=${formatMiB(bundleStats.size)} / ${formatMiB(MAX_BACKEND_ENTRY_BYTES)}, ` +
      `backend=${formatMiB(backendBytes)} / ${formatMiB(MAX_BACKEND_DIRECTORY_BYTES)}, ` +
      `typescript=${runtimeSummary.packageVersion}, libs=${runtimeSummary.standardLibFiles.length}\n`
  );
}

function verifyPresentationBuildWorkerRuntime(workerPath) {
  const smokePath = fileURLToPath(
    new URL('./verify-presentation-build-worker.mjs', import.meta.url)
  );
  const result = spawnSync(process.execPath, [smokePath, path.resolve(workerPath)], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        'Slides presentation build worker artifact smoke failed.',
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
  process.stdout.write(result.stdout);
}

function verifyNoVmIncompatibleNodeImports(bundleSource) {
  const dynamicNodeImport = /\bimport\(['"](?:node:)?(?:fs|https)['"]\)/u;
  if (dynamicNodeImport.test(bundleSource)) {
    throw new Error(
      'Slides backend bundle contains a VM-incompatible dynamic import for Node built-ins.'
    );
  }
}

/** PptxGenJS 的 CommonJS 路径必须能在 Electron VM cached-data 语义下运行。 */
function verifyPptxGenVmRuntime() {
  const smokePath = fileURLToPath(new URL('./verify-pptxgen-vm-runtime.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', smokePath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      ['PptxGenJS Electron VM runtime smoke failed.', result.stdout.trim(), result.stderr.trim()]
        .filter(Boolean)
        .join('\n')
    );
  }
  process.stdout.write(result.stdout);
}

function verifyLazyBackendRuntime(bundlePath) {
  const smokePath = fileURLToPath(new URL('./verify-backend-runtime.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [smokePath, path.resolve(bundlePath)], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      ['Slides backend lazy runtime smoke failed.', result.stdout.trim(), result.stderr.trim()]
        .filter(Boolean)
        .join('\n')
    );
  }
  process.stdout.write(result.stdout);
}

async function verifyPackagedTypeScriptRuntime(runtimeDir) {
  const manifest = JSON.parse(
    await readFile(path.join(runtimeDir, 'runtime-manifest.json'), 'utf8')
  );
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.packageVersion !== 'string' ||
    !Array.isArray(manifest.standardLibRoots) ||
    !Array.isArray(manifest.standardLibFiles)
  ) {
    throw new Error('Slides packaged TypeScript runtime manifest is invalid.');
  }
  if (!sameStrings(manifest.standardLibRoots, SLIDES_TYPESCRIPT_STANDARD_LIB_ROOTS)) {
    throw new Error('Slides packaged TypeScript runtime roots differ from the compiler contract.');
  }

  const libDir = path.join(runtimeDir, 'lib');
  const expectedLibFiles = await collectTypeScriptStandardLibClosure({
    libDir,
    roots: SLIDES_TYPESCRIPT_STANDARD_LIB_ROOTS,
  });
  const actualLibFiles = (await readdir(libDir))
    .filter(fileName => fileName.startsWith('lib.') && fileName.endsWith('.d.ts'))
    .sort((left, right) => left.localeCompare(right));
  if (
    !sameStrings(expectedLibFiles, actualLibFiles) ||
    !sameStrings(expectedLibFiles, manifest.standardLibFiles)
  ) {
    throw new Error(
      `Slides packaged TypeScript standard libs are not the exact reference closure: expected=${expectedLibFiles.length}, actual=${actualLibFiles.length}.`
    );
  }

  const packageRequire = createRequire(path.resolve(runtimeDir, 'package.json'));
  const typescript = packageRequire('./lib/typescript.js');
  assertTypeScriptCompilerApi(typescript);
  verifyCompilerProgram(typescript, expectedLibFiles, true);
  verifyCompilerProgram(typescript, expectedLibFiles, false);

  return {
    packageVersion: manifest.packageVersion,
    standardLibFiles: expectedLibFiles,
  };
}

function verifyCompilerProgram(typescript, expectedLibFiles, legal) {
  const virtualFileName = '/virtual/slides-artifact-check.js';
  const source = legal
    ? 'const values = Array.from(new Set([1, 2])); Promise.resolve(values);'
    : 'Math.slidesMissingMethod();';
  const options = {
    target: typescript.ScriptTarget.ES2020,
    module: typescript.ModuleKind.ESNext,
    allowJs: true,
    checkJs: true,
    noEmit: true,
    skipLibCheck: true,
    lib: ['lib.es2020.d.ts'],
    types: [],
  };
  const sourceFile = typescript.createSourceFile(
    virtualFileName,
    source,
    typescript.ScriptTarget.ES2020,
    true,
    typescript.ScriptKind.JS
  );
  const host = typescript.createCompilerHost(options, true);
  const readSourceFile = host.getSourceFile.bind(host);
  const loadedLibFiles = new Set();
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fileName === virtualFileName) return sourceFile;
    if (path.basename(fileName).startsWith('lib.') && fileName.endsWith('.d.ts')) {
      loadedLibFiles.add(path.basename(fileName));
    }
    return readSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const program = typescript.createProgram({
    rootNames: [virtualFileName],
    options,
    host,
  });
  const diagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ];
  if (legal && diagnostics.length > 0) {
    throw new Error(
      `Slides packaged TypeScript runtime rejected legal ES2020 source: TS${diagnostics[0]?.code}.`
    );
  }
  if (!legal && diagnostics.length === 0) {
    throw new Error(
      'Slides packaged TypeScript runtime did not report an invalid standard-library call.'
    );
  }
  if (!sameStrings([...loadedLibFiles].sort(), expectedLibFiles)) {
    throw new Error(
      `Slides packaged TypeScript compiler loaded an unexpected standard-lib closure: expected=${expectedLibFiles.length}, loaded=${loadedLibFiles.size}.`
    );
  }
}

function assertTypeScriptCompilerApi(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.createSourceFile !== 'function' ||
    typeof value.createProgram !== 'function' ||
    typeof value.createCompilerHost !== 'function'
  ) {
    throw new Error('Slides packaged TypeScript runtime does not expose the compiler API.');
  }
}

function findEntryOutput(outputs, bundlePath) {
  const normalizedBundlePath = normalizePath(bundlePath);
  for (const [outputPath, output] of Object.entries(outputs ?? {})) {
    const normalizedOutputPath = normalizePath(outputPath);
    if (
      normalizedOutputPath === normalizedBundlePath ||
      normalizedBundlePath.endsWith(`/${normalizedOutputPath}`)
    ) {
      return output;
    }
  }
  throw new Error(`Slides backend metafile is missing entry output: ${bundlePath}`);
}

async function measureDirectoryBytes(directory, excludedPaths) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (excludedPaths.has(normalizePath(path.resolve(entryPath)))) continue;
    if (entry.isDirectory()) {
      total += await measureDirectoryBytes(entryPath, excludedPaths);
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
  }
  return total;
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
