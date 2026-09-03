import fs from 'node:fs';
import path from 'node:path';

const readManifestIdentity = pluginDirectory => {
  const manifestPath = path.join(pluginDirectory, 'plugin.json');
  const stat = fs.statSync(manifestPath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    throw new Error(`bundled plugin directory is missing plugin.json: ${pluginDirectory}`);
  }

  const input = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`bundled plugin manifest must be an object: ${manifestPath}`);
  }
  if (typeof input.id !== 'string' || input.id.trim().length === 0) {
    throw new Error(`bundled plugin manifest must declare a non-empty id: ${manifestPath}`);
  }
  return input.id;
};

const sortStrings = values => [...values].sort((left, right) => left.localeCompare(right));

/**
 * bundled root 是正式发布集合的物理投影。目录集合、目录名和 manifest id 必须
 * 同时一致，避免本机残留目录把未进入 release target 的插件带进随包或 smoke。
 */
export function assertBundledPluginRootMatchesPluginIds({ bundledPluginRoot, expectedPluginIds }) {
  const expectedIds = sortStrings(new Set(expectedPluginIds));
  if (expectedIds.length !== expectedPluginIds.length) {
    throw new Error('expected bundled plugin ids must be unique');
  }

  const rootStat = fs.statSync(bundledPluginRoot, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory()) {
    throw new Error(`bundled plugin root must be a directory: ${bundledPluginRoot}`);
  }

  const entries = fs.readdirSync(bundledPluginRoot, { withFileTypes: true });
  const unexpectedEntries = entries.filter(entry => !entry.isDirectory()).map(entry => entry.name);
  if (unexpectedEntries.length > 0) {
    throw new Error(
      `bundled plugin root contains non-plugin entries: ${sortStrings(unexpectedEntries).join(', ')}`
    );
  }

  const actualIds = sortStrings(entries.map(entry => entry.name));
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(
      `bundled plugin root does not match release targets: expected=${expectedIds.join(',') || '(empty)'}, actual=${actualIds.join(',') || '(empty)'}`
    );
  }

  for (const pluginId of actualIds) {
    const manifestId = readManifestIdentity(path.join(bundledPluginRoot, pluginId));
    if (manifestId !== pluginId) {
      throw new Error(
        `bundled plugin directory does not match manifest id: directory=${pluginId}, manifest=${manifestId}`
      );
    }
  }

  return actualIds;
}
