import fs from 'node:fs';
import path from 'node:path';
import type { RendererPluginEntry } from 'src/electron-main/plugins/loader/rendererPluginEntries';
import { readPluginManifestSummary } from 'src/electron-main/plugins/loader/pluginLayout';
import { readPluginArtifactIdentity } from 'src/features/plugins/install/functions/readPluginArtifactIdentity';

export interface PluginAssemblyTrustInput {
  readonly packaged: boolean;
  readonly workspaceRoot: string;
  readonly backendDirectDirs: readonly string[];
  readonly bundledPluginRoot: string | undefined;
}

export interface ApplicationSurfaceTrustInput extends PluginAssemblyTrustInput {
  readonly getRegisteredPluginDirectory: (pluginId: string) => string | undefined;
  readonly recordDiagnostic?: (diagnostic: { readonly pluginId: string; readonly message: string }) => void;
}

export interface PluginAssemblySource {
  readonly pluginId: string;
  readonly version: string;
  readonly pluginDir?: string;
  readonly sourceKind?: RendererPluginEntry['sourceKind'];
}

function matchesBundledArtifact(entry: PluginAssemblySource, bundledRoot: string | undefined): boolean {
  if (!bundledRoot || !entry.pluginDir || entry.sourceKind !== 'active') return false;
  const bundledDirectory = path.join(bundledRoot, entry.pluginId);
  if (!fs.existsSync(bundledDirectory)) return false;
  const bundled = readPluginManifestSummary(bundledDirectory);
  if (bundled?.id !== entry.pluginId || bundled.version !== entry.version) return false;
  // 复用不可变 artifact 清单身份；这是与受准入随包产物等价，不是发布方签名验证。
  return readPluginArtifactIdentity(bundledDirectory) === readPluginArtifactIdentity(entry.pluginDir);
}

function isDevelopmentPluginDirectory(pluginDirectory: string, workspaceRoot: string): boolean {
  const pluginsRoot = path.resolve(workspaceRoot, 'packages', 'plugins');
  const relative = path.relative(pluginsRoot, pluginDirectory);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function isTrustedPluginAssembly(entry: PluginAssemblySource, input: PluginAssemblyTrustInput): boolean {
  if (!entry.pluginDir) return false;
  const pluginDirectory = path.resolve(entry.pluginDir);
  const developmentSource = !input.packaged && (
    (entry.sourceKind === 'official-source' && isDevelopmentPluginDirectory(pluginDirectory, input.workspaceRoot)) ||
    input.backendDirectDirs.some(directory => path.resolve(directory) === pluginDirectory)
  );
  return developmentSource || matchesBundledArtifact(entry, input.bundledPluginRoot);
}

/** Renderer 必须与通过装配准入的 Backend 来自同一目录。 */
export function isTrustedPluginSource(entry: PluginAssemblySource, input: ApplicationSurfaceTrustInput): boolean {
  const registeredDirectory = input.getRegisteredPluginDirectory(entry.pluginId);
  return Boolean(entry.pluginDir && registeredDirectory &&
    path.resolve(entry.pluginDir) === path.resolve(registeredDirectory) &&
    isTrustedPluginAssembly(entry, input));
}

/** 产品组合根只授一个已约定场景；插件 manifest/meta 不能自授页面或固定入口。 */
export function mapTrustedRendererApplicationSurfaces(
  entries: readonly RendererPluginEntry[], input: ApplicationSurfaceTrustInput,
): RendererPluginEntry[] {
  const trustedSurfaceRequestCount = entries.filter(entry =>
    entry.requestedApplicationSurfaceSlot === 'knowledge-base' && isTrustedPluginSource(entry, input)
  ).length;
  if (trustedSurfaceRequestCount > 1) {
    input.recordDiagnostic?.({
      pluginId: entries.find(entry => entry.requestedApplicationSurfaceSlot === 'knowledge-base')?.pluginId ?? 'unknown',
      message: `多个可信插件申请同一 application surface，未授予 knowledge-base 槽位（count=${trustedSurfaceRequestCount}）`,
    });
  }
  return entries.map(entry => {
    if (trustedSurfaceRequestCount !== 1 || entry.requestedApplicationSurfaceSlot !== 'knowledge-base' ||
      !isTrustedPluginSource(entry, input)) return entry;
    return { ...entry, applicationSurfaceSlot: 'knowledge-base' };
  });
}
