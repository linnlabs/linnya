import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { extractFile } from '@electron/asar';

import type { ArtifactContentBom } from '../definitions/artifactContentBom';
import type { ArtifactPackageMap } from '../definitions/artifactPackageMap';
import { createArtifactPackageMap } from '../functions/artifactPackageMap';
import { resolveDesktopArtifactPaths } from '../functions/desktopArtifactPaths';

interface JsonRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArtifactContentBom(value: unknown): value is ArtifactContentBom {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'linnya-desktop-artifact-content' ||
    !isRecord(value.identity) ||
    !isRecord(value.source) ||
    !isRecord(value.environment) ||
    !isRecord(value.summary) ||
    !Array.isArray(value.artifacts) ||
    !Array.isArray(value.entries)
  ) {
    return false;
  }
  if (
    typeof value.identity.name !== 'string' ||
    typeof value.identity.version !== 'string' ||
    typeof value.source.revision !== 'string' ||
    typeof value.source.dirty !== 'boolean' ||
    typeof value.environment.nodeVersion !== 'string' ||
    typeof value.environment.platform !== 'string' ||
    typeof value.environment.architecture !== 'string' ||
    typeof value.summary.treeSha256 !== 'string'
  ) {
    return false;
  }
  return value.entries.every(
    entry =>
      isRecord(entry) &&
      typeof entry.path === 'string' &&
      typeof entry.scope === 'string' &&
      typeof entry.category === 'string' &&
      (entry.type === 'file' || entry.type === 'symlink')
  );
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeOrVerifyPackageMap(input: {
  readonly map: ArtifactPackageMap;
  readonly outputPath: string;
  readonly verify: boolean;
}): void {
  const rendered = `${JSON.stringify(input.map, null, 2)}\n`;
  if (input.verify) {
    if (!fs.existsSync(input.outputPath)) {
      throw new Error(`artifact package map 不存在：${input.outputPath}`);
    }
    if (fs.readFileSync(input.outputPath, 'utf8') !== rendered) {
      throw new Error(`artifact package map 与当前产物不一致：${input.outputPath}`);
    }
    return;
  }
  fs.writeFileSync(input.outputPath, rendered, 'utf8');
}

export function generateDesktopArtifactPackageMap(input: {
  readonly architecture: 'arm64' | 'x64';
  readonly platform: 'darwin' | 'win32';
  readonly rootDir: string;
  readonly verify: boolean;
}): string {
  const paths = resolveDesktopArtifactPaths(input);
  const contentBomPath = path.join(paths.outputRoot, `${paths.evidenceBaseName}.content-bom.json`);
  const outputPath = path.join(paths.outputRoot, `${paths.evidenceBaseName}.package-map.json`);
  if (!fs.statSync(paths.appRoot).isDirectory() || !fs.statSync(paths.asarPath).isFile()) {
    throw new Error('Desktop package map 缺少已打包应用或 app.asar');
  }
  const contentBomBytes = fs.readFileSync(contentBomPath);
  const contentBomValue: unknown = JSON.parse(contentBomBytes.toString('utf8'));
  if (!isArtifactContentBom(contentBomValue)) {
    throw new Error(`Desktop content BOM 合同无效：${contentBomPath}`);
  }
  const packageManifests = contentBomValue.entries
    .filter(
      entry =>
        entry.scope === 'app-asar' &&
        entry.type === 'file' &&
        entry.path.includes('node_modules/') &&
        entry.path.endsWith('/package.json')
    )
    .map(entry => {
      const bytes = extractFile(paths.asarPath, entry.path, false);
      if (sha256(bytes) !== entry.sha256) {
        throw new Error(`artifact package.json 与 content BOM hash 不一致：${entry.path}`);
      }
      let manifest: unknown;
      try {
        manifest = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        throw new Error(
          `artifact package.json 不是合法 JSON：${entry.path} — ${error instanceof Error ? error.message : String(error)}`
        );
      }
      return { packageJsonPath: entry.path, sha256: entry.sha256, manifest };
    });
  const lockPath = path.join(input.rootDir, 'production-package-lock.json');
  const lockBytes = fs.readFileSync(lockPath);
  const productionPackageLock: unknown = JSON.parse(lockBytes.toString('utf8'));
  const map = createArtifactPackageMap({
    contentBom: contentBomValue,
    contentBomSha256: sha256(contentBomBytes),
    packageManifests,
    productionPackageLock,
    productionPackageLockSha256: sha256(lockBytes),
  });
  writeOrVerifyPackageMap({ map, outputPath, verify: input.verify });
  return outputPath;
}

function readCliValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function main(): void {
  const platform = readCliValue('platform');
  const architecture = readCliValue('architecture');
  if (
    (platform !== 'darwin' && platform !== 'win32') ||
    (architecture !== 'arm64' && architecture !== 'x64')
  ) {
    throw new Error(
      '用法：generateDesktopArtifactPackageMap.ts --platform=<darwin|win32> --architecture=<arm64|x64> [--verify]'
    );
  }
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const outputPath = generateDesktopArtifactPackageMap({
    rootDir,
    platform,
    architecture,
    verify: process.argv.includes('--verify'),
  });
  process.stdout.write(`[desktop-package-map] ${path.relative(rootDir, outputPath)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
