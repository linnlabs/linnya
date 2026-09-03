import fs from 'node:fs';
import path from 'node:path';

import { parsePluginManifest } from '@app/schemas';
import { loadBackendPluginsFromDisk } from '../../../src/electron-main/plugins/loader/diskPluginLoader';
import { assertBundledPluginRootMatchesPluginIds } from '../functions/pluginBundledRootContract.mjs';

function readRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the plugin artifact runtime smoke`);
  }
  return value;
}

function readAppVersion(): string {
  const input: unknown = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('root package.json must be an object');
  }
  const version = 'version' in input ? input.version : undefined;
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error('root package.json must declare a non-empty version');
  }
  return version;
}

const pluginId = readRequiredEnvironmentVariable('LINNYA_PLUGIN_ARTIFACT_SMOKE_ID');
const bundledPluginRoot = readRequiredEnvironmentVariable('LINNYA_BUNDLED_PLUGIN_ROOT');
const pluginDirectory = path.join(bundledPluginRoot, pluginId);

assertBundledPluginRootMatchesPluginIds({
  bundledPluginRoot,
  expectedPluginIds: [pluginId],
});

const manifestInput: unknown = JSON.parse(
  fs.readFileSync(path.join(pluginDirectory, 'plugin.json'), 'utf8')
);
const manifest = parsePluginManifest(manifestInput);
const loadedPlugins = loadBackendPluginsFromDisk({
  directPluginDirs: [pluginDirectory],
  appVersion: readAppVersion(),
});

if (loadedPlugins.length !== 1) {
  throw new Error(
    `${pluginId} isolated artifact runtime smoke expected one backend contribution, loaded=${loadedPlugins.length}`
  );
}
const loadedPlugin = loadedPlugins[0];
if (
  loadedPlugin?.contribution.meta.id !== manifest.id ||
  loadedPlugin.contribution.meta.version !== manifest.version
) {
  throw new Error(
    `${pluginId} isolated artifact runtime identity mismatch: manifest=${manifest.id}@${manifest.version}, loaded=${loadedPlugin?.contribution.meta.id ?? 'missing'}@${loadedPlugin?.contribution.meta.version ?? 'missing'}`
  );
}

console.log(`[plugin-artifact:${pluginId}] backend loaded from isolated bundled root`);
