import fs from 'node:fs';
import path from 'node:path';
import type { RendererPluginEntry } from 'src/electron-main/plugins/loader/rendererPluginEntries';
import { readPluginManifestSummary } from 'src/electron-main/plugins/loader/pluginLayout';
import { readPluginArtifactIdentity } from 'src/features/plugins/install/functions/readPluginArtifactIdentity';
import type { TrustedPluginCatalogKeys } from 'src/features/plugins/catalog/definitions/pluginCatalog';
import { verifyCatalogInstallReceipt } from 'src/features/plugins/catalog/functions/verifyCatalogInstallReceipt';
import { trustedPluginCatalogKeys } from 'src/features/plugins/catalog/registry/trustedPluginCatalogKeys';
import { createPluginCatalogStateStore } from 'src/features/plugins/catalog/infrastructure/pluginCatalogStateStore';

export interface PluginAssemblyTrustInput {
  readonly packaged: boolean;
  readonly workspaceRoot: string;
  readonly backendDirectDirs: readonly string[];
  readonly bundledPluginRoot: string | undefined;
  /** 默认使用内置插件 catalog 公钥；测试可注入临时 key。 */
  readonly trustedCatalogKeys?: TrustedPluginCatalogKeys;
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

/** catalog-official：回执中的签名信封仍由受信 key 签发，且版本目录与安装时一致。 */
export function matchesCatalogInstall(entry: PluginAssemblySource, trustedKeys: TrustedPluginCatalogKeys): boolean {
  if (!entry.pluginDir || entry.sourceKind !== 'active') return false;
  // 版本目录为 <userPluginRoot>/<pluginId>/<version>；本机 catalog 状态与之同根。
  const userPluginRoot = path.dirname(path.dirname(path.resolve(entry.pluginDir)));
  return verifyCatalogInstallReceipt({
    pluginId: entry.pluginId,
    version: entry.version,
    pluginDirectory: entry.pluginDir,
    trustedKeys,
    laterRevocations: createPluginCatalogStateStore({ userPluginRoot }).readRevocations(),
  }).admitted;
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
  return developmentSource
    || matchesBundledArtifact(entry, input.bundledPluginRoot)
    || matchesCatalogInstall(entry, input.trustedCatalogKeys ?? trustedPluginCatalogKeys);
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
