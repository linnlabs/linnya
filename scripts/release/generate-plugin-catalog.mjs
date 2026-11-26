import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { buildSignedPluginCatalogPayload } from './functions/buildSignedPluginCatalogPayload.ts';
import { collectCatalogRuntimes } from './functions/collectCatalogRuntimes.ts';
import { measureZipUnpackedSize } from './functions/measureZipUnpackedSize.ts';
import { parsePluginManifest } from '../../packages/schemas/src/plugins/manifest.ts';
import {
  listOfficialPluginReleaseTargetIds,
  readPluginIdsFromCliOrEnv,
  repoRoot,
  resolvePluginDownloadBaseUrl,
  resolvePluginPackageDir,
} from './plugin-release-targets.mjs';

const outputPath = process.env.LINNYA_PLUGIN_CATALOG_OUTPUT
  ? path.resolve(repoRoot, process.env.LINNYA_PLUGIN_CATALOG_OUTPUT)
  : path.join(repoRoot, 'dist/plugin-catalog/stable.payload.json');

const pluginIds = readPluginIdsFromCliOrEnv({
  defaultIds: listOfficialPluginReleaseTargetIds(),
});

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

const sha512Hex = (buffer) => createHash('sha512').update(buffer).digest('hex');

const readPluginCatalogEntry = async (pluginId) => {
  const packageDir = resolvePluginPackageDir(pluginId);
  const artifactDir = path.join(packageDir, 'dist/artifacts');
  const downloadBaseUrl = resolvePluginDownloadBaseUrl(pluginId);
  const manifest = parsePluginManifest(await readJson(path.join(packageDir, 'plugin.json')));
  const id = manifest.id;
  if (id !== pluginId) {
    throw new Error(`Requested pluginId=${pluginId}, but manifest id=${id}`);
  }
  const version = manifest.version;
  const zipName = `${id}-${version}.zip`;
  const zipPath = path.join(artifactDir, zipName);
  const zipBuffer = await fs.readFile(zipPath);

  return {
    id,
    name: manifest.name,
    version,
    developer: manifest.developer,
    description: manifest.description,
    ...(manifest.permissions === undefined ? {} : { permissions: manifest.permissions }),
    ...(manifest.dependsOn === undefined ? {} : { dependsOn: manifest.dependsOn }),
    ...(manifest.ownedFileTypes.length === 0 ? {} : { ownedFileTypes: manifest.ownedFileTypes }),
    ...(manifest.compat?.minApp === undefined ? {} : { minApp: manifest.compat.minApp }),
    ...(manifest.compat?.rendererUi === undefined
      ? {}
      : { rendererUi: manifest.compat.rendererUi }),
    artifactUrl: `${downloadBaseUrl}/${zipName}`,
    sha512: sha512Hex(zipBuffer),
    size: zipBuffer.byteLength,
    unpackedSize: await measureZipUnpackedSize(zipBuffer),
    // 插件 manifest 声明的原生运行时依赖；catalog 必须同时列出满足 range 的运行时组件。
    requiresRuntimes: manifest.requiresRuntimes,
  };
};

async function readRuntimeMetadata(root) {
  const found = [];
  const walk = async directory => {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === 'runtime.json') found.push(await readJson(full));
    }
  };
  await walk(root);
  return found;
}

function readPositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (fallback === undefined) throw new Error(`缺少 ${name}`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} 必须是正整数: ${raw}`);
  return value;
}

const main = async () => {
  const channel = process.env.LINNYA_PLUGIN_CATALOG_CHANNEL ?? 'stable';
  if (channel !== 'stable' && channel !== 'beta') throw new Error(`LINNYA_PLUGIN_CATALOG_CHANNEL 无效: ${channel}`);
  const plugins = await Promise.all(pluginIds.map(readPluginCatalogEntry));
  // 运行时组件由 package-runtime-component 按平台产出；插件声明的运行时必须都能满足。
  const runtimeRoot = path.resolve(repoRoot, process.env.LINNYA_PLUGIN_CATALOG_RUNTIMES_DIR ?? 'dist/runtime-components');
  const runtimeMetadata = await readRuntimeMetadata(runtimeRoot);
  const runtimes = collectCatalogRuntimes({
    metadata: runtimeMetadata,
    downloadRootUrl: process.env.LINNYA_PLUGIN_RUNTIME_DOWNLOAD_ROOT_URL ?? 'https://download.linnya.com/plugins',
    plugins,
  });
  // 待签名 payload：序号由发布方给出，发布环境签名时再对照线上 catalog 核对必须递增。
  const payload = buildSignedPluginCatalogPayload({
    channel,
    sequence: readPositiveInteger('LINNYA_PLUGIN_CATALOG_SEQUENCE'),
    issuedAt: process.env.LINNYA_PLUGIN_CATALOG_ISSUED_AT ? new Date(process.env.LINNYA_PLUGIN_CATALOG_ISSUED_AT) : new Date(),
    validDays: readPositiveInteger('LINNYA_PLUGIN_CATALOG_VALID_DAYS', 30),
    plugins,
    runtimes,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Created ${path.relative(repoRoot, outputPath)}（待签名，sequence=${payload.sequence}）`);
};

await main();
