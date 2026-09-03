import fs from 'node:fs';
import path from 'node:path';

import type { PluginId } from '@app/schemas';

export const pluginRemovalMarkerFileName = '.user-removed.json';

interface PluginRemovalMarker {
  readonly pluginId: PluginId;
  readonly removedAt: number;
}

function resolvePluginInstallDir(userPluginRoot: string, pluginId: PluginId): string {
  const rootDir = path.resolve(userPluginRoot);
  const pluginDir = path.resolve(rootDir, pluginId);
  const relative = path.relative(rootDir, pluginDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`插件安装目录不能指向插件根目录外: ${pluginId}`);
  }
  return pluginDir;
}

export function resolvePluginRemovalMarkerPath(userPluginRoot: string, pluginId: PluginId): string {
  return path.join(resolvePluginInstallDir(userPluginRoot, pluginId), pluginRemovalMarkerFileName);
}

export function markPluginUserRemoved(userPluginRoot: string, pluginId: PluginId, removedAt = Date.now()): void {
  const markerPath = resolvePluginRemovalMarkerPath(userPluginRoot, pluginId);
  const marker: PluginRemovalMarker = { pluginId, removedAt };
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

export function clearPluginUserRemovedMarker(userPluginRoot: string, pluginId: PluginId): void {
  fs.rmSync(resolvePluginRemovalMarkerPath(userPluginRoot, pluginId), { force: true });
}

export function isPluginUserRemoved(userPluginRoot: string, pluginId: PluginId): boolean {
  return fs.existsSync(resolvePluginRemovalMarkerPath(userPluginRoot, pluginId));
}
