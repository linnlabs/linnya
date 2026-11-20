import path from 'node:path';
import { registeredBackendPluginDirectories } from './registeredPluginDirectories';
import { pluginDiagnostics } from './diagnostics';
import { assertPluginRuntimeEnabled } from './pluginRuntimeAccess';
import { isTrustedPluginAssembly } from './rendererApplicationSurfaceTrust';
import {
  readBackendDirectPluginDirsFromEnv,
  readPluginManifestSummary,
  type PluginManifestSummary,
} from 'src/electron-main/plugins/loader/pluginLayout';
import { requireInstalledDistributionIdentity } from 'src/shared/distribution-identity';
import { readInstalledRuntimePathRoots } from 'src/shared/runtime-paths';

function isDevelopmentPluginDirectory(directory: string, developmentRoot: string): boolean {
  const pluginsRoot = path.resolve(developmentRoot, 'packages', 'plugins');
  const relative = path.relative(pluginsRoot, path.resolve(directory));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** 既有产品资料只交给同源官方 artifact；meta.builtin 和插件自报 ID 不构成授权。 */
export function assertKnowledgeResourceAdmission(pluginId: string): void {
  assertPluginRuntimeEnabled({ pluginId, pluginName: '知识库', action: '访问知识库资源' });
  if (!isTrustedKnowledgeResourceSource(pluginId))
    throw new Error('该插件来源不能接管已有知识库资料');
}

/** 产品装配事实也供启停使用，不能依赖当前 enabled 值或插件自报 builtin。 */
export function isTrustedKnowledgeResourceSource(pluginId: string): boolean {
  const trustedPluginIds = [...registeredBackendPluginDirectories.entries()].flatMap(([candidateId, directory]) => {
    const manifest = readPluginManifestSummary(directory);
    return manifest?.applicationSurfaceSlot && isTrustedBackendApplicationSurface(directory, manifest)
      ? [candidateId]
      : [];
  });
  if (trustedPluginIds.length > 1) {
    pluginDiagnostics.record({
      level: 'error',
      pluginId,
      capability: null,
      message: `多个可信插件申请知识库资料接管，已拒绝全部来源（count=${trustedPluginIds.length}）`,
    });
  }
  return trustedPluginIds.length === 1 && trustedPluginIds[0] === pluginId;
}

/** 在登记贡献前即可判定来源；旧 active 指针本身不证明发行 provenance。 */
export function isTrustedBackendApplicationSurface(directory: string, manifest: PluginManifestSummary): boolean {
  const roots = readInstalledRuntimePathRoots();
  if (!roots) return false;
  const packaged = requireInstalledDistributionIdentity().packaged;
  const backendDirectDirs = packaged ? [] : readBackendDirectPluginDirsFromEnv();
  const sourceKind =
    !packaged && isDevelopmentPluginDirectory(directory, roots.developmentRoot)
      ? 'official-source'
      : backendDirectDirs.some(value => path.resolve(value) === path.resolve(directory))
        ? 'direct'
        : 'active';
  return isTrustedPluginAssembly(
    {
      pluginId: manifest.id,
      pluginDir: directory,
      version: manifest.version,
      sourceKind,
    },
    {
      packaged,
      workspaceRoot: roots.developmentRoot,
      backendDirectDirs,
      bundledPluginRoot: process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT,
    }
  );
}
