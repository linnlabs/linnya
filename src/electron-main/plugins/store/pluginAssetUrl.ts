import fs from 'node:fs';
import { resolveInsidePluginDir } from '../loader/pluginLayout';

export function normalizePluginAssetRelativePath(relativePath: string, label: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`${label} 必须位于插件目录内: ${relativePath}`);
  }
  return normalized;
}

export function resolvePluginAssetFilePath(
  pluginDir: string,
  relativePath: string,
  label: string,
): string {
  return resolveInsidePluginDir(pluginDir, relativePath, label);
}

export function resolveExistingPluginAssetUrl(options: {
  readonly pluginDir: string;
  readonly pluginId: string;
  readonly relativePath: string;
  readonly label: string;
}): string {
  const filePath = resolvePluginAssetFilePath(options.pluginDir, options.relativePath, options.label);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${options.label} 文件不存在: ${options.relativePath}`);
  }

  const normalized = normalizePluginAssetRelativePath(options.relativePath, options.label);
  const encodedPath = normalized.split('/').map(encodeURIComponent).join('/');
  return `plugin://${options.pluginId}/${encodedPath}`;
}
