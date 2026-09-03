import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

import {
  readSinglePluginIdFromCli,
  repoRoot,
  resolvePluginDownloadBaseUrl,
  resolvePluginPackageDir,
  resolvePluginProductionDistDirectories,
} from './plugin-release-targets.mjs';

const pluginId = readSinglePluginIdFromCli({
  scriptName: 'scripts/release/package-plugin-artifact.mjs',
});
const packageDir = resolvePluginPackageDir(pluginId);
const downloadBaseUrl = resolvePluginDownloadBaseUrl(pluginId);
const distDir = path.join(packageDir, 'dist');
const resourcesDir = path.join(packageDir, 'resources');
const artifactDir = path.join(distDir, 'artifacts');
const manifestPath = path.join(packageDir, 'plugin.json');
const checksumPath = path.join(distDir, 'SHA512SUMS');
const stableZipDate = new Date('1980-01-01T00:00:00.000Z');

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

const readRequiredString = (source, key, label) => {
  const value = source[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${pluginId} plugin manifest must provide ${label}`);
  }
  return value;
};

const readOptionalStringArray = (source, key, label) => {
  const value = source[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new Error(`${pluginId} plugin manifest ${label} must be an array of non-empty strings when provided`);
  }
  return value;
};

const readRequiredStringArray = (source, key, label) => {
  const value = source[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${pluginId} plugin manifest must provide ${label} as a non-empty string array`);
  }
  if (value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new Error(`${pluginId} plugin manifest ${label} must contain only non-empty strings`);
  }
  return value;
};

const normalizePluginRelativePath = (rawPath, label) => {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\.\//u, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`${pluginId} plugin manifest ${label} must stay inside the plugin package: ${rawPath}`);
  }
  return normalized;
};

const buildManifestAssetFiles = (manifestInput) => {
  const assetPaths = [
    ...readOptionalStringArray(manifestInput, 'screenshots', 'screenshots')
      .map((rawPath, index) => ({ rawPath, label: `screenshots[${index}]` })),
  ];

  return assetPaths.map(({ rawPath, label }) => {
    const artifactPath = normalizePluginRelativePath(rawPath, label);
    return {
      absolutePath: path.join(packageDir, ...artifactPath.split('/')),
      artifactPath,
    };
  });
};

const readEntryFiles = (entry) => Object.entries(entry).map(([entryName, rawPath]) => {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new Error(`${pluginId} plugin manifest entry.${entryName} must be a non-empty string`);
  }
  const artifactPath = normalizePluginRelativePath(rawPath, `entry.${entryName}`);
  return {
    absolutePath: path.join(packageDir, ...artifactPath.split('/')),
    artifactPath,
  };
});

const readManifest = async () => {
  const input = await readJson(manifestPath);
  if (!isRecord(input)) {
    throw new Error(`${pluginId} plugin manifest must be a JSON object`);
  }

  const manifestPluginId = readRequiredString(input, 'id', 'id');
  if (manifestPluginId !== pluginId) {
    throw new Error(`Requested pluginId=${pluginId}, but manifest id=${manifestPluginId}`);
  }
  readRequiredString(input, 'name', 'name');
  readRequiredString(input, 'description', 'description');
  readRequiredString(input, 'developer', 'developer');
  readRequiredStringArray(input, 'details', 'details');

  const entry = input.entry;
  if (!isRecord(entry)) {
    throw new Error(`${pluginId} plugin manifest must provide entry object`);
  }

  const entryFiles = readEntryFiles(entry);
  if (entryFiles.length === 0) {
    throw new Error(`${pluginId} plugin manifest entry must declare at least one entrypoint`);
  }

  const rendererUi = isRecord(input.compat) && typeof input.compat.rendererUi === 'string'
    && input.compat.rendererUi.trim().length > 0
    ? input.compat.rendererUi
    : undefined;
  if (typeof entry.renderer === 'string' && !rendererUi) {
    throw new Error(`${pluginId} renderer plugin manifest must provide compat.rendererUi`);
  }

  return {
    id: manifestPluginId,
    version: readRequiredString(input, 'version', 'version'),
    minApp: isRecord(input.compat) && typeof input.compat.minApp === 'string' && input.compat.minApp.trim().length > 0
      ? input.compat.minApp
      : undefined,
    rendererUi,
    hasSkills: Array.isArray(input.skills) && input.skills.length > 0,
    entryFiles,
    displayAssetFiles: buildManifestAssetFiles(input),
    productionDistDirectories: resolvePluginProductionDistDirectories(pluginId, entry),
  };
};

const assertFileExists = async (filePath) => {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`Missing required plugin artifact file: ${path.relative(repoRoot, filePath)}`);
  }
};

const assertDirectoryExists = async (dir) => {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Missing required plugin dist directory: ${path.relative(repoRoot, dir)}`);
  }
};

const assertResourcesForManifest = async (manifest) => {
  if (!manifest.hasSkills) return;
  await assertDirectoryExists(path.join(resourcesDir, 'skills'));
};

const walkFiles = async (dir, prefix) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    const entryPrefix = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(entryPath, entryPrefix));
      continue;
    }

    if (entry.isFile()) {
      files.push({ absolutePath: entryPath, artifactPath: entryPrefix });
    }
  }

  return files;
};

const walkOptionalFiles = async (dir, prefix) => {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) {
    return [];
  }
  return walkFiles(dir, prefix);
};

const sha512Hex = (buffer) => createHash('sha512').update(buffer).digest('hex');

const main = async () => {
  const manifest = await readManifest();

  const requiredEntries = [
    ...manifest.entryFiles.map((file) => file.absolutePath),
    ...manifest.displayAssetFiles.map((file) => file.absolutePath),
  ];
  await Promise.all(requiredEntries.map(assertFileExists));
  await assertDirectoryExists(distDir);
  await Promise.all(manifest.productionDistDirectories.map((directory) => (
    assertDirectoryExists(path.join(packageDir, ...directory.split('/')))
  )));
  await assertResourcesForManifest(manifest);

  const productionDistFiles = (await Promise.all(
    manifest.productionDistDirectories.map((directory) => (
      walkFiles(path.join(packageDir, ...directory.split('/')), directory)
    )),
  )).flat();

  const artifactFilesByPath = new Map([
    { absolutePath: manifestPath, artifactPath: 'plugin.json' },
    ...productionDistFiles,
    ...await walkOptionalFiles(resourcesDir, 'resources'),
    ...manifest.entryFiles,
    ...manifest.displayAssetFiles,
  ].map((file) => [file.artifactPath, file]));
  const artifactFiles = Array.from(artifactFilesByPath.values())
    .sort((left, right) => left.artifactPath.localeCompare(right.artifactPath));

  const checksums = [];
  const zip = new JSZip();

  for (const file of artifactFiles) {
    const content = await fs.readFile(file.absolutePath);
    checksums.push(`${sha512Hex(content)}  ${file.artifactPath}`);
    zip.file(file.artifactPath, content, {
      createFolders: false,
      date: stableZipDate,
    });
  }

  const checksumContent = `${checksums.join('\n')}\n`;
  await fs.writeFile(checksumPath, checksumContent, 'utf8');
  zip.file('SHA512SUMS', checksumContent, {
    createFolders: false,
    date: stableZipDate,
  });

  // artifact 目录只保存本次 manifest 版本，避免旧 zip 被误当成当前候选产物。
  await fs.rm(artifactDir, { recursive: true, force: true });
  await fs.mkdir(artifactDir, { recursive: true });
  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: {
      level: 9,
    },
  });
  const zipPath = path.join(artifactDir, `${manifest.id}-${manifest.version}.zip`);
  const zipSha512 = sha512Hex(zipBuffer);
  await fs.writeFile(zipPath, zipBuffer);
  await fs.writeFile(`${zipPath}.sha512`, `${zipSha512}  ${path.basename(zipPath)}\n`, 'utf8');

  const latestManifest = {
    version: manifest.version,
    ...(manifest.minApp ? { minApp: manifest.minApp } : {}),
    ...(manifest.rendererUi ? { rendererUi: manifest.rendererUi } : {}),
    url: `${downloadBaseUrl}/${path.basename(zipPath)}`,
    sha512: zipSha512,
  };
  const latestPath = path.join(artifactDir, 'latest.json');
  await fs.writeFile(latestPath, `${JSON.stringify(latestManifest, null, 2)}\n`, 'utf8');

  const contentBomScript = path.join(
    repoRoot,
    'scripts/release/orchestration/generatePluginArtifactContentBom.ts',
  );
  execFileSync(process.execPath, ['--import', 'tsx', contentBomScript, pluginId], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  console.log(`Created ${path.relative(repoRoot, zipPath)}`);
  console.log(`Created ${path.relative(repoRoot, `${zipPath}.sha512`)}`);
  console.log(`Created ${path.relative(repoRoot, latestPath)}`);
  console.log(
    `Created ${path.relative(repoRoot, path.join(artifactDir, `${manifest.id}-${manifest.version}.content-bom.json`))}`,
  );
};

await main();
