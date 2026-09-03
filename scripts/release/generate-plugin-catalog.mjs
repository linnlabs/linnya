import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parsePluginCatalog } from '../../packages/schemas/src/plugins/catalog.ts';
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
  : path.join(repoRoot, 'dist/plugin-catalog/index.json');

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
  };
};

const main = async () => {
  const catalog = parsePluginCatalog({
    plugins: await Promise.all(pluginIds.map(readPluginCatalogEntry)),
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`Created ${path.relative(repoRoot, outputPath)}`);
};

await main();
