import fs from 'node:fs';
import path from 'node:path';
import type { RendererPluginEntry } from 'src/electron-main/plugins/loader/rendererPluginEntries';
import { readPluginManifestSummary } from 'src/electron-main/plugins/loader/pluginLayout';
import { readPluginArtifactIdentity } from 'src/features/plugins/install/functions/readPluginArtifactIdentity';

interface ApplicationSurfaceTrustInput {
  readonly packaged: boolean;
  readonly workspaceRoot: string;
  readonly backendDirectDirs: readonly string[];
  readonly bundledPluginRoot: string | undefined;
  readonly getRegisteredPluginDirectory: (pluginId: string) => string | undefined;
}

function matchesBundledArtifact(entry: RendererPluginEntry, bundledRoot: string | undefined): boolean {
  if (!bundledRoot || !entry.pluginDir || entry.sourceKind !== 'active') return false;
  const bundledDirectory = path.join(bundledRoot, entry.pluginId);
  if (!fs.existsSync(bundledDirectory)) return false;
  const bundled = readPluginManifestSummary(bundledDirectory);
  if (bundled?.id !== entry.pluginId || bundled.version !== entry.version) return false;
  // 复用不可变 artifact 清单身份；这是与受准入随包产物等价，不是发布方签名验证。
  return readPluginArtifactIdentity(bundledDirectory) === readPluginArtifactIdentity(entry.pluginDir);
}

/** 产品组合根只授一个已约定场景；插件 manifest/meta 不能自授页面或固定入口。 */
export function mapTrustedRendererApplicationSurfaces(
  entries: readonly RendererPluginEntry[], input: ApplicationSurfaceTrustInput,
): RendererPluginEntry[] {
  return entries.map(entry => {
    if (entry.pluginId !== 'knowledge' || !entry.pluginDir) return entry;
    const pluginDirectory = path.resolve(entry.pluginDir);
    const registeredDirectory = input.getRegisteredPluginDirectory(entry.pluginId);
    if (!registeredDirectory || path.resolve(registeredDirectory) !== pluginDirectory) return entry;
    const developmentSource = !input.packaged && (
      (entry.sourceKind === 'official-source' && pluginDirectory === path.resolve(input.workspaceRoot, 'packages/plugins/knowledge')) ||
      input.backendDirectDirs.some(directory => path.resolve(directory) === pluginDirectory)
    );
    if (!developmentSource && !matchesBundledArtifact(entry, input.bundledPluginRoot)) return entry;
    return { ...entry, applicationSurfaceSlot: 'knowledge-base' };
  });
}
