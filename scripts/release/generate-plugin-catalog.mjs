import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { buildSignedPluginCatalogPayload } from './functions/buildSignedPluginCatalogPayload.ts';
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
    // 原生运行时依赖在运行时组件落地后由插件 manifest 声明；在此之前为空。
    requiresRuntimes: [],
  };
};

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
  // 待签名 payload：序号由发布方给出，linnya-release 签名时再对照线上 catalog 核对必须递增。
  const payload = buildSignedPluginCatalogPayload({
    channel,
    sequence: readPositiveInteger('LINNYA_PLUGIN_CATALOG_SEQUENCE'),
    issuedAt: process.env.LINNYA_PLUGIN_CATALOG_ISSUED_AT ? new Date(process.env.LINNYA_PLUGIN_CATALOG_ISSUED_AT) : new Date(),
    validDays: readPositiveInteger('LINNYA_PLUGIN_CATALOG_VALID_DAYS', 30),
    plugins: await Promise.all(pluginIds.map(readPluginCatalogEntry)),
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Created ${path.relative(repoRoot, outputPath)}（待签名，sequence=${payload.sequence}）`);
};

await main();
