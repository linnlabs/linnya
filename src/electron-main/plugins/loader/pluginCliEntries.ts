import fs from 'node:fs';
import path from 'node:path';

import type { PluginId } from '@app/schemas';
import {
  discoverPluginDirsFromLayout,
  readPluginManifestSummary,
  resolveInsidePluginDir,
  type PluginLayoutDiagnosticReporter,
} from './pluginLayout';

export interface PluginCliEntry {
  readonly pluginId: PluginId;
  readonly version: string;
  readonly pluginDir: string;
  readonly entryPath: string;
}

function report(
  reporter: PluginLayoutDiagnosticReporter | undefined,
  pluginId: PluginId | null,
  message: string,
): void {
  reporter?.({ pluginId, message });
}

/**
 * 只读取插件布局中的 CLI 文件定位事实。
 *
 * 中文说明：这里不加载 backend contribution，也不解析 CLI 参数；command mode
 * 和 launcher 需要在独立短进程中完成入口发现，不能因为查一个 CLI 而启动重型插件 runtime。
 */
export function listPluginCliEntries(options: {
  readonly pluginRoot?: string;
  readonly directPluginDirs?: readonly string[];
  readonly reportDiagnostic?: PluginLayoutDiagnosticReporter;
}): PluginCliEntry[] {
  const entries: PluginCliEntry[] = [];
  const seen = new Set<PluginId>();
  for (const pluginDir of discoverPluginDirsFromLayout(options)) {
    try {
      const manifest = readPluginManifestSummary(pluginDir);
      if (!manifest?.entry.command || seen.has(manifest.id)) {
        continue;
      }
      const entryPath = resolveInsidePluginDir(pluginDir, manifest.entry.command, 'entry.command');
      if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
        report(options.reportDiagnostic, manifest.id, `插件 CLI 入口不存在: ${manifest.entry.command}`);
        continue;
      }
      seen.add(manifest.id);
      entries.push(Object.freeze({
        pluginId: manifest.id,
        version: manifest.version,
        pluginDir: path.resolve(pluginDir),
        entryPath: path.resolve(entryPath),
      }));
    } catch (error) {
      report(
        options.reportDiagnostic,
        null,
        `读取插件 CLI 入口失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return entries;
}
