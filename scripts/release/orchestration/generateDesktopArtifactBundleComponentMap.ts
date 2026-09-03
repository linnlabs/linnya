import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { BundleBuildTrace } from '../../build/bundle-trace/definitions/bundleBuildTrace.mjs';
import type { BundleBuildTraceSet } from '../../build/bundle-trace/definitions/bundleBuildTraceSet.mjs';
import type { ArtifactBundleComponentMap } from '../definitions/artifactBundleComponentMap';
import type { ArtifactContentBom } from '../definitions/artifactContentBom';
import { createArtifactBundleComponentMap } from '../functions/artifactBundleComponentMap';
import { resolveDesktopArtifactPaths } from '../functions/desktopArtifactPaths';

interface JsonRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArtifactContentBom(value: unknown): value is ArtifactContentBom {
  return isRecord(value)
    && value.kind === 'linnya-desktop-artifact-content'
    && value.schemaVersion === 1
    && isRecord(value.identity)
    && isRecord(value.source)
    && isRecord(value.environment)
    && isRecord(value.summary)
    && Array.isArray(value.entries)
    && Array.isArray(value.artifacts);
}

function isBundleBuildTraceSet(value: unknown): value is BundleBuildTraceSet {
  return isRecord(value)
    && value.kind === 'linnya-bundle-build-trace-set'
    && value.schemaVersion === 1
    && isRecord(value.identity)
    && isRecord(value.source)
    && isRecord(value.summary)
    && Array.isArray(value.traces);
}

function isBundleBuildTrace(value: unknown): value is BundleBuildTrace {
  return isRecord(value)
    && value.kind === 'linnya-bundle-build-trace'
    && value.schemaVersion === 1
    && typeof value.buildTarget === 'string'
    && Array.isArray(value.buildInputs)
    && Array.isArray(value.outputs)
    && isRecord(value.tool);
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(filePath: string): { readonly bytes: Buffer; readonly value: unknown } {
  const bytes = fs.readFileSync(filePath);
  return { bytes, value: JSON.parse(bytes.toString('utf8')) as unknown };
}

function writeOrVerify(input: {
  readonly map: ArtifactBundleComponentMap;
  readonly outputPath: string;
  readonly verify: boolean;
}): void {
  const rendered = `${JSON.stringify(input.map, null, 2)}\n`;
  if (input.verify) {
    if (!fs.existsSync(input.outputPath) || fs.readFileSync(input.outputPath, 'utf8') !== rendered) {
      throw new Error(`Desktop bundle component map 与当前构建不一致：${input.outputPath}`);
    }
    return;
  }
  fs.writeFileSync(input.outputPath, rendered, 'utf8');
}

export function generateDesktopArtifactBundleComponentMap(input: {
  readonly architecture: 'arm64' | 'x64';
  readonly platform: 'darwin' | 'win32';
  readonly rootDir: string;
  readonly traceRoot: string;
  readonly verify: boolean;
}): string {
  const paths = resolveDesktopArtifactPaths(input);
  const contentBomPath = path.join(paths.outputRoot, `${paths.evidenceBaseName}.content-bom.json`);
  const traceSetPath = path.join(input.traceRoot, 'bundle-trace-set.json');
  const outputPath = path.join(
    paths.outputRoot,
    `${paths.evidenceBaseName}.bundle-component-map.json`,
  );
  const contentBomJson = readJson(contentBomPath);
  if (!isArtifactContentBom(contentBomJson.value)) {
    throw new Error(`Desktop content BOM 合同无效：${contentBomPath}`);
  }
  const traceSetJson = readJson(traceSetPath);
  if (!isBundleBuildTraceSet(traceSetJson.value)) {
    throw new Error(`bundle trace set 合同无效：${traceSetPath}`);
  }
  const traces = traceSetJson.value.traces.map(traceSummary => {
    if (
      !isRecord(traceSummary)
      || typeof traceSummary.fileName !== 'string'
      || path.basename(traceSummary.fileName) !== traceSummary.fileName
      || !traceSummary.fileName.endsWith('.bundle-trace.json')
    ) {
      throw new Error('bundle trace set 含无效 trace summary');
    }
    const tracePath = path.join(input.traceRoot, traceSummary.fileName);
    const traceJson = readJson(tracePath);
    if (typeof traceSummary.sha256 !== 'string' || sha256(traceJson.bytes) !== traceSummary.sha256) {
      throw new Error(`bundle trace 文件 hash 与 trace set 不一致：${traceSummary.fileName}`);
    }
    if (!isBundleBuildTrace(traceJson.value)) {
      throw new Error(`bundle trace 合同无效：${traceSummary.fileName}`);
    }
    return { fileName: traceSummary.fileName, trace: traceJson.value };
  });
  const map = createArtifactBundleComponentMap({
    bundleTraceSet: traceSetJson.value,
    bundleTraceSetSha256: sha256(traceSetJson.bytes),
    contentBom: contentBomJson.value,
    contentBomSha256: sha256(contentBomJson.bytes),
    traces,
  });
  writeOrVerify({ map, outputPath, verify: input.verify });
  return outputPath;
}

function readCliValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function main(): void {
  const platform = readCliValue('platform');
  const architecture = readCliValue('architecture');
  const traceRootArgument = readCliValue('trace-root');
  if (
    (platform !== 'darwin' && platform !== 'win32')
    || (architecture !== 'arm64' && architecture !== 'x64')
    || !traceRootArgument
  ) {
    throw new Error(
      '用法：generateDesktopArtifactBundleComponentMap.ts --platform=<darwin|win32> --architecture=<arm64|x64> --trace-root=<path> [--verify]',
    );
  }
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const outputPath = generateDesktopArtifactBundleComponentMap({
    architecture,
    platform,
    rootDir,
    traceRoot: path.resolve(rootDir, traceRootArgument),
    verify: process.argv.includes('--verify'),
  });
  process.stdout.write(`[desktop-bundle-component-map] ${path.relative(rootDir, outputPath)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
