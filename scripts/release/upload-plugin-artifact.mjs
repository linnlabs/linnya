import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';

import { parsePluginManifest } from '../../packages/schemas/dist/esm/index.js';
import {
  readSinglePluginIdFromCli,
  repoRoot,
  resolvePluginDownloadBaseUrl,
  resolvePluginPackageDir,
  resolvePluginR2Prefix,
} from './plugin-release-targets.mjs';

const pluginId = readSinglePluginIdFromCli({
  scriptName: 'scripts/release/upload-plugin-artifact.mjs',
});
const packageDir = resolvePluginPackageDir(pluginId);
const artifactDir = path.join(packageDir, 'dist/artifacts');
const manifestPath = path.join(packageDir, 'plugin.json');

const bucket = process.env.LINNYA_R2_BUCKET || 'linny-app-store';
const r2Prefix = resolvePluginR2Prefix(pluginId);
const downloadBaseUrl = resolvePluginDownloadBaseUrl(pluginId);
const dryRun = process.env.LINNYA_PLUGIN_UPLOAD_DRY_RUN === '1';
const logPrefix = `[plugin-upload:${pluginId}]`;

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

const normalizePluginRelativePath = (rawPath, label) => {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\.\//u, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`${pluginId} plugin upload manifest ${label} must stay inside the plugin package: ${rawPath}`);
  }
  return normalized;
};

const readContentType = (artifactPath) => {
  if (artifactPath.endsWith('.svg')) return 'image/svg+xml';
  if (artifactPath.endsWith('.png')) return 'image/png';
  if (artifactPath.endsWith('.jpg') || artifactPath.endsWith('.jpeg')) return 'image/jpeg';
  if (artifactPath.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
};

const sha512Hex = (buffer) => createHash('sha512').update(buffer).digest('hex');

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const isMissingObjectOutput = (output) => output.includes('specified key does not exist')
  || output.includes('NoSuchKey')
  || output.includes('404');

const readManifestSchemaError = (error) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const parseManifestForRelease = (input, label) => {
  try {
    return parsePluginManifest(input);
  } catch (error) {
    throw new Error(`${label} plugin.json 不符合当前插件 manifest schema:\n${readManifestSchemaError(error)}`);
  }
};

const buildManifestDisplayAssetPaths = (manifest) => {
  const assetPaths = [
    ...(manifest.screenshots ?? []).map((rawPath, index) => ({
      rawPath,
      label: `screenshots[${index}]`,
    })),
  ];

  return assetPaths.map(({ rawPath, label }) => normalizePluginRelativePath(rawPath, label));
};

const readPluginManifest = async () => {
  const manifest = parseManifestForRelease(await readJson(manifestPath), 'source');
  if (manifest.id !== pluginId) {
    throw new Error(`Requested pluginId=${pluginId}, but manifest id=${manifest.id}`);
  }

  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    developer: manifest.developer,
    version: manifest.version,
    minApp: manifest.compat?.minApp,
    rendererUi: manifest.compat?.rendererUi,
    displayAssetPaths: buildManifestDisplayAssetPaths(manifest),
  };
};

const assertFile = async (filePath) => {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`Missing file: ${path.relative(repoRoot, filePath)}`);
  }
};

const readZipManifest = async (zipBuffer, label) => {
  const zip = await JSZip.loadAsync(zipBuffer);
  const manifestFile = zip.file('plugin.json');
  if (!manifestFile) {
    throw new Error(`${label} plugin artifact 缺少 plugin.json`);
  }
  const manifest = parseManifestForRelease(JSON.parse(await manifestFile.async('string')), label);
  return { zip, manifest };
};

const assertZipEntry = (zip, rawPath, label) => {
  const artifactPath = normalizePluginRelativePath(rawPath, label);
  if (!zip.file(artifactPath)) {
    throw new Error(`${pluginId} plugin artifact 缺少 ${label}: ${artifactPath}`);
  }
};

const validateArtifactManifest = async (zipBuffer, expected, label) => {
  const { zip, manifest } = await readZipManifest(zipBuffer, label);
  if (manifest.id !== expected.id || manifest.version !== expected.version) {
    throw new Error(
      `${label} plugin artifact manifest 不匹配: expected=${expected.id}@${expected.version}, actual=${manifest.id}@${manifest.version}`,
    );
  }

  for (const [entryName, entryPath] of Object.entries(manifest.entry)) {
    assertZipEntry(zip, entryPath, `entry.${entryName}`);
  }
  for (const assetPath of buildManifestDisplayAssetPaths(manifest)) {
    assertZipEntry(zip, assetPath, `display asset ${assetPath}`);
  }

  return manifest;
};

const putObject = (key, filePath, options) => {
  const args = [
    'r2',
    'object',
    'put',
    `${bucket}/${key}`,
    '--remote',
    '--file',
    filePath,
    '--content-type',
    options.contentType,
    '--cache-control',
    options.cacheControl,
  ];
  const printable = `wrangler ${args.join(' ')}`;
  if (dryRun) {
    console.log(`[dry-run] ${printable}`);
    return;
  }

  const result = spawnSync('wrangler', args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`wrangler upload failed: ${printable}`);
  }
};

const fetchWithMessage = async (url) => {
  const response = await globalThis.fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`public artifact fetch failed: ${url} -> ${response.status} ${response.statusText}`);
  }
  return response;
};

const fetchPublicJson = async (url) => {
  const response = await fetchWithMessage(url);
  return response.json();
};

const fetchPublicBuffer = async (url) => {
  const response = await fetchWithMessage(url);
  return Buffer.from(await response.arrayBuffer());
};

const retryPublicCheck = async (label, fn) => {
  const attempts = 5;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(750 * attempt);
      }
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${readManifestSchemaError(lastError)}`);
};

const verifyPublicUpload = async (
  expected,
  latestManifest,
  zipName,
  contentBomName,
  contentBomSha512,
) => {
  if (dryRun) {
    console.log('[dry-run] skip public artifact verification');
    return;
  }

  await retryPublicCheck('public latest.json verification', async () => {
    const latestUrl = `${downloadBaseUrl}/latest.json`;
    const publicLatest = await fetchPublicJson(latestUrl);
    if (
      publicLatest?.version !== latestManifest.version
      || publicLatest?.url !== latestManifest.url
      || publicLatest?.sha512 !== latestManifest.sha512
    ) {
      throw new Error(`public latest.json still does not match ${expected.id}@${expected.version}`);
    }
  });

  const publicZipBuffer = await retryPublicCheck('public plugin zip verification', async () => {
    const buffer = await fetchPublicBuffer(latestManifest.url);
    const publicSha512 = sha512Hex(buffer);
    if (publicSha512 !== latestManifest.sha512) {
      throw new Error(`public zip sha512 mismatch for ${zipName}: expected=${latestManifest.sha512}, actual=${publicSha512}`);
    }
    await validateArtifactManifest(buffer, expected, 'public');
    return buffer;
  });

  await retryPublicCheck('public plugin content BOM verification', async () => {
    const publicContentBom = await fetchPublicBuffer(`${downloadBaseUrl}/${contentBomName}`);
    const publicSha512 = sha512Hex(publicContentBom);
    if (publicSha512 !== contentBomSha512) {
      throw new Error(
        `public content BOM sha512 mismatch for ${contentBomName}: expected=${contentBomSha512}, actual=${publicSha512}`,
      );
    }
  });

  for (const assetPath of expected.displayAssetPaths) {
    await retryPublicCheck(`public plugin asset verification: ${assetPath}`, async () => {
      const assetBuffer = await fetchPublicBuffer(`${downloadBaseUrl}/${assetPath}`);
      if (assetBuffer.byteLength === 0) {
        throw new Error(`public asset is empty: ${assetPath}`);
      }
    });
  }

  console.log(
    `${logPrefix} public verification passed: ${zipName} (${publicZipBuffer.byteLength} bytes)`,
  );
};

const downloadRemoteObject = async (key) => {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'linnya-plugin-r2-'));
  const filePath = path.join(tempDir, 'object');
  const args = [
    'r2',
    'object',
    'get',
    `${bucket}/${key}`,
    '--remote',
    '--file',
    filePath,
  ];
  const result = spawnSync('wrangler', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw result.error;
  }
  if (result.status === 0) {
    return { exists: true, filePath, tempDir };
  }

  const output = `${result.stdout}\n${result.stderr}`;
  await fs.rm(tempDir, { recursive: true, force: true });
  if (isMissingObjectOutput(output)) {
    return { exists: false };
  }
  throw new Error(`wrangler object check failed: wrangler ${args.join(' ')}\n${output.trim()}`);
};

const ensureImmutableObjectCanBeUploaded = async (key, localSha512) => {
  if (dryRun) {
    console.log(`[dry-run] check immutable object: ${bucket}/${key}`);
    return true;
  }

  const remoteObject = await downloadRemoteObject(key);
  if (!remoteObject.exists) {
    return true;
  }

  try {
    const remoteSha512 = sha512Hex(await fs.readFile(remoteObject.filePath));
    if (remoteSha512 !== localSha512) {
      throw new Error([
        `R2 already has a different immutable plugin artifact: ${bucket}/${key}`,
        `remote sha512: ${remoteSha512}`,
        `local sha512:  ${localSha512}`,
        `Bump ${path.relative(repoRoot, manifestPath)} version before uploading different bytes.`,
      ].join('\n'));
    }
    console.log(`${logPrefix} immutable object already matches: ${bucket}/${key}`);
    return false;
  } finally {
    await fs.rm(remoteObject.tempDir, { recursive: true, force: true });
  }
};

const main = async () => {
  const manifest = await readPluginManifest();
  const zipName = `${manifest.id}-${manifest.version}.zip`;
  const zipPath = path.join(artifactDir, zipName);
  const contentBomName = `${manifest.id}-${manifest.version}.content-bom.json`;
  const contentBomPath = path.join(artifactDir, contentBomName);
  await assertFile(zipPath);
  await assertFile(contentBomPath);
  await Promise.all(manifest.displayAssetPaths.map((assetPath) => (
    assertFile(path.join(packageDir, ...assetPath.split('/')))
  )));

  const zipBuffer = await fs.readFile(zipPath);
  await validateArtifactManifest(zipBuffer, manifest, 'local');
  const zipSha512 = sha512Hex(zipBuffer);
  const contentBomScript = path.join(
    repoRoot,
    'scripts/release/orchestration/generatePluginArtifactContentBom.ts',
  );
  execFileSync(
    process.execPath,
    ['--import', 'tsx', contentBomScript, pluginId, '--verify'],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  const contentBomSha512 = sha512Hex(await fs.readFile(contentBomPath));
  const latestManifest = {
    version: manifest.version,
    ...(manifest.minApp ? { minApp: manifest.minApp } : {}),
    ...(manifest.rendererUi ? { rendererUi: manifest.rendererUi } : {}),
    url: `${downloadBaseUrl}/${zipName}`,
    sha512: zipSha512,
  };
  const latestPath = path.join(artifactDir, 'latest.json');
  await fs.writeFile(latestPath, `${JSON.stringify(latestManifest, null, 2)}\n`, 'utf8');

  console.log(`${logPrefix} artifact:`, path.relative(repoRoot, zipPath));
  console.log(`${logPrefix} content BOM:`, path.relative(repoRoot, contentBomPath));
  console.log(`${logPrefix} latest:`, path.relative(repoRoot, latestPath));
  console.log(`${logPrefix} bucket:`, bucket);
  console.log(`${logPrefix} prefix:`, r2Prefix);

  const zipKey = `${r2Prefix}/${zipName}`;
  const contentBomKey = `${r2Prefix}/${contentBomName}`;
  const shouldUploadZip = await ensureImmutableObjectCanBeUploaded(zipKey, zipSha512);
  const shouldUploadContentBom = await ensureImmutableObjectCanBeUploaded(
    contentBomKey,
    contentBomSha512,
  );

  if (shouldUploadZip) {
    putObject(zipKey, zipPath, {
      contentType: 'application/zip',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  }
  if (shouldUploadContentBom) {
    putObject(contentBomKey, contentBomPath, {
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  }
  putObject(`${r2Prefix}/latest.json`, latestPath, {
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'no-cache',
  });
  for (const assetPath of manifest.displayAssetPaths) {
    putObject(`${r2Prefix}/${assetPath}`, path.join(packageDir, ...assetPath.split('/')), {
      contentType: readContentType(assetPath),
      cacheControl: 'public, max-age=3600',
    });
  }

  await verifyPublicUpload(
    manifest,
    latestManifest,
    zipName,
    contentBomName,
    contentBomSha512,
  );
};

await main();
