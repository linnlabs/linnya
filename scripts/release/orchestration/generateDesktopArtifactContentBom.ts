import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { extractFile, listPackage, statFile } from '@electron/asar';

import type {
  ArtifactContentBom,
  ArtifactContentEntry,
  ArtifactContentIdentity,
  ArtifactEnvelopeDescriptor,
  ArtifactSourceIdentity,
} from '../definitions/artifactContentBom';
import {
  classifyDesktopArtifactPath,
  createArtifactContentBom,
  normalizeArtifactPath,
  sha256Hex,
} from '../functions/artifactContentBom';
import { resolveDesktopArtifactPaths } from '../functions/desktopArtifactPaths';
import { deriveReleaseArtifactNames } from '../functions/deriveArtifactNames';
import {
  readArtifactEnvelope,
  readArtifactSourceIdentity,
  writeOrVerifyArtifactContentBom,
} from './artifactContentBomSupport';

interface DesktopArtifactPath {
  readonly filePath: string;
  readonly role: ArtifactEnvelopeDescriptor['role'];
}

function isPathInsideRoot(rootDir: string, targetPath: string): boolean {
  const relative = path.relative(rootDir, targetPath);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function collectFilesystemEntries(
  appRoot: string,
  currentDir: string = appRoot
): Promise<readonly ArtifactContentEntry[]> {
  const directoryEntries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  const entries: ArtifactContentEntry[] = [];
  for (const directoryEntry of directoryEntries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const absolutePath = path.join(currentDir, directoryEntry.name);
    const artifactPath = normalizeArtifactPath(path.relative(appRoot, absolutePath));
    const stat = await fs.promises.lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      const target = await fs.promises.readlink(absolutePath);
      if (path.isAbsolute(target)) {
        throw new Error(`Desktop artifact 含绝对符号链接：${artifactPath} -> ${target}`);
      }
      const resolvedTarget = path.resolve(path.dirname(absolutePath), target);
      if (!isPathInsideRoot(appRoot, resolvedTarget)) {
        throw new Error(`Desktop artifact 符号链接越界：${artifactPath} -> ${target}`);
      }
      entries.push({
        type: 'symlink',
        scope: 'app-filesystem',
        path: artifactPath,
        target: target.replaceAll('\\', '/'),
        category: classifyDesktopArtifactPath(artifactPath, 'app-filesystem'),
      });
      continue;
    }
    if (stat.isDirectory()) {
      entries.push(...(await collectFilesystemEntries(appRoot, absolutePath)));
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`Desktop artifact 含不支持的文件类型：${artifactPath}`);
    }
    const bytes = await fs.promises.readFile(absolutePath);
    entries.push({
      type: 'file',
      scope: 'app-filesystem',
      path: artifactPath,
      category: classifyDesktopArtifactPath(artifactPath, 'app-filesystem'),
      executable: (stat.mode & 0o111) !== 0,
      size: bytes.byteLength,
      sha256: sha256Hex(bytes),
    });
  }
  return entries;
}

function collectAsarEntries(asarPath: string): readonly ArtifactContentEntry[] {
  const entries: ArtifactContentEntry[] = [];
  for (const listedPath of listPackage(asarPath, { isPack: false })) {
    const artifactPath = normalizeArtifactPath(listedPath.replace(/^\/+/, ''));
    const metadata = statFile(asarPath, artifactPath, false);
    if ('files' in metadata) continue;
    if ('link' in metadata) {
      const target = normalizeArtifactPath(metadata.link);
      entries.push({
        type: 'symlink',
        scope: 'app-asar',
        path: artifactPath,
        target,
        category: classifyDesktopArtifactPath(artifactPath, 'app-asar'),
      });
      continue;
    }
    const bytes = extractFile(asarPath, artifactPath, false);
    entries.push({
      type: 'file',
      scope: 'app-asar',
      path: artifactPath,
      category: classifyDesktopArtifactPath(artifactPath, 'app-asar'),
      executable: metadata.executable === true,
      size: bytes.byteLength,
      sha256: sha256Hex(bytes),
    });
  }
  return entries;
}

function resolveAsarPath(appRoot: string, platform: 'darwin' | 'win32'): string {
  return platform === 'darwin'
    ? path.join(appRoot, 'Contents', 'Resources', 'app.asar')
    : path.join(appRoot, 'resources', 'app.asar');
}

export async function createDesktopArtifactContentBom(input: {
  readonly appRoot: string;
  readonly artifactPaths: readonly DesktopArtifactPath[];
  readonly environment: ArtifactContentBom['environment'];
  readonly identity: ArtifactContentIdentity;
  readonly source: ArtifactSourceIdentity;
}): Promise<ArtifactContentBom> {
  if (input.identity.platform !== 'darwin' && input.identity.platform !== 'win32') {
    throw new Error('Desktop artifact BOM 只接受 darwin 或 win32');
  }
  const appRootStat = await fs.promises.stat(input.appRoot).catch(() => undefined);
  if (!appRootStat?.isDirectory()) {
    throw new Error(`Desktop app root 不存在：${input.appRoot}`);
  }
  const asarPath = resolveAsarPath(input.appRoot, input.identity.platform);
  const asarStat = await fs.promises.stat(asarPath).catch(() => undefined);
  if (!asarStat?.isFile()) throw new Error(`Desktop app.asar 不存在：${asarPath}`);

  const entries = [
    ...(await collectFilesystemEntries(input.appRoot)),
    ...collectAsarEntries(asarPath),
  ];
  return createArtifactContentBom({
    kind: 'linnya-desktop-artifact-content',
    identity: input.identity,
    source: input.source,
    environment: input.environment,
    artifacts: input.artifactPaths.map(artifact =>
      readArtifactEnvelope(artifact.filePath, artifact.role)
    ),
    entries,
  });
}

function readCliValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function readElectronVersion(rootDir: string): string {
  const manifest: unknown = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'node_modules', 'electron', 'package.json'), 'utf8')
  );
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('已安装 Electron package.json 必须是对象');
  }
  const version = Reflect.get(manifest, 'version');
  if (typeof version !== 'string' || !version) {
    throw new Error('已安装 Electron package.json 缺少 version');
  }
  return version;
}

function readProductionPackageLockSha256(rootDir: string): string {
  const lockPath = path.join(rootDir, 'production-package-lock.json');
  if (!fs.existsSync(lockPath)) {
    throw new Error('缺少 production-package-lock.json，不能建立 Desktop 依赖来源证明');
  }
  return createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');
}

export async function generateDesktopArtifactContentBom(input: {
  readonly architecture: 'arm64' | 'x64';
  readonly platform: 'darwin' | 'win32';
  readonly rootDir: string;
  readonly verify: boolean;
}): Promise<string> {
  const paths = resolveDesktopArtifactPaths(input);
  const packageInfo = paths.packageInfo;
  const artifactNames = deriveReleaseArtifactNames({
    productName: packageInfo.productName,
    version: packageInfo.version,
  });
  const artifactPaths: readonly DesktopArtifactPath[] =
    input.platform === 'darwin'
      ? [
          {
            filePath: path.join(paths.outputRoot, artifactNames.macDmg),
            role: 'desktop-installer',
          },
          {
            filePath: path.join(paths.outputRoot, artifactNames.macZip),
            role: 'desktop-update-package',
          },
          {
            filePath: path.join(paths.outputRoot, artifactNames.macZipBlockmap),
            role: 'release-blockmap',
          },
          {
            filePath: path.join(paths.outputRoot, artifactNames.macLatestYml),
            role: 'release-metadata',
          },
        ]
      : [
          {
            filePath: path.join(paths.outputRoot, artifactNames.winInstaller),
            role: 'desktop-installer',
          },
          {
            filePath: path.join(paths.outputRoot, artifactNames.winInstallerBlockmap),
            role: 'release-blockmap',
          },
          {
            filePath: path.join(paths.outputRoot, artifactNames.winLatestYml),
            role: 'release-metadata',
          },
        ];
  const bom = await createDesktopArtifactContentBom({
    appRoot: paths.appRoot,
    artifactPaths,
    identity: {
      name: packageInfo.productName,
      version: packageInfo.version,
      platform: input.platform,
      architecture: input.architecture,
    },
    source: readArtifactSourceIdentity(input.rootDir),
    environment: {
      nodeVersion: process.version,
      electronVersion: readElectronVersion(input.rootDir),
      platform: process.platform,
      architecture: process.arch,
      productionPackageLockSha256: readProductionPackageLockSha256(input.rootDir),
    },
  });
  const outputPath = path.join(paths.outputRoot, `${paths.evidenceBaseName}.content-bom.json`);
  writeOrVerifyArtifactContentBom({ bom, outputPath, verify: input.verify });
  return outputPath;
}

async function main(): Promise<void> {
  const platform = readCliValue('platform');
  const architecture = readCliValue('architecture');
  if (
    (platform !== 'darwin' && platform !== 'win32') ||
    (architecture !== 'arm64' && architecture !== 'x64')
  ) {
    throw new Error(
      '用法：generateDesktopArtifactContentBom.ts --platform=<darwin|win32> --architecture=<arm64|x64> [--verify]'
    );
  }
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const outputPath = await generateDesktopArtifactContentBom({
    rootDir,
    platform,
    architecture,
    verify: process.argv.includes('--verify'),
  });
  process.stdout.write(`[desktop-content-bom] ${path.relative(rootDir, outputPath)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
