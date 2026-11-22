import fs from 'node:fs';
import path from 'node:path';
import { parsePluginManifest, type PluginId, type PluginManifest } from '@app/schemas';

/**
 * 清理数据不应依赖插件当前是否已注册：卸载后 active 目录会被移除，
 * 但随包 artifact 仍是可信的 manifest 来源。这里把来源解析集中在清理
 * 领域，避免 IPC 和启动恢复各自猜测路径。
 */
export interface PluginCleanupManifestSource {
  readonly manifest: PluginManifest;
  readonly directory: string;
  /** declared：安装包内远程分发插件的 plugin.json 声明（无代码），用于未安装时判断资料与清理。 */
  readonly kind: 'registered' | 'bundled' | 'declared';
}

export function readPluginManifestForCleanup(options: {
  readonly pluginId: PluginId;
  readonly registeredPluginDirectory?: string;
  readonly bundledPluginRoot?: string | null;
  readonly declarationRoot?: string | null;
}): PluginCleanupManifestSource | null {
  const candidates: readonly { readonly directory: string; readonly kind: PluginCleanupManifestSource['kind'] }[] = [
    ...(options.registeredPluginDirectory
      ? [{ directory: options.registeredPluginDirectory, kind: 'registered' as const }]
      : []),
    ...(options.bundledPluginRoot
      ? [{ directory: path.join(options.bundledPluginRoot, options.pluginId), kind: 'bundled' as const }]
      : []),
    ...(options.declarationRoot
      ? [{ directory: path.join(options.declarationRoot, options.pluginId), kind: 'declared' as const }]
      : []),
  ];

  for (const candidate of candidates) {
    const manifestPath = path.join(candidate.directory, 'plugin.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = parsePluginManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    if (manifest.id !== options.pluginId) {
      throw new Error(`插件 manifest ID 与清理目标不一致: ${manifest.id}`);
    }
    return {
      manifest,
      directory: candidate.directory,
      kind: candidate.kind,
    };
  }

  return null;
}
