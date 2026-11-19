import path from 'node:path';
import { getRegisteredBackendPluginDirectory } from './registeredPluginDirectories';
import { registeredBackendPluginDirectories } from './registeredPluginDirectories';
import { pluginDiagnostics } from './diagnostics';
import { assertPluginRuntimeEnabled } from './pluginRuntimeAccess';
import { isTrustedPluginSource } from './rendererApplicationSurfaceTrust';
import {
  readBackendDirectPluginDirsFromEnv,
  readPluginManifestSummary,
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
  const directory = getRegisteredBackendPluginDirectory(pluginId);
  const manifest = directory ? readPluginManifestSummary(directory) : null;
  const roots = readInstalledRuntimePathRoots();
  if (!directory || !manifest || !roots) return false;
  const packaged = requireInstalledDistributionIdentity().packaged;
  const backendDirectDirs = packaged ? [] : readBackendDirectPluginDirsFromEnv();
  const sourceKind =
    !packaged && isDevelopmentPluginDirectory(directory, roots.developmentRoot)
      ? 'official-source'
      : backendDirectDirs.some(value => path.resolve(value) === path.resolve(directory))
        ? 'direct'
        : 'active';
  if (manifest.applicationSurfaceSlot !== 'knowledge-base') return false;
  const trustedPluginIds = [...registeredBackendPluginDirectories.entries()].flatMap(([candidateId, candidateDirectory]) => {
    const candidateManifest = readPluginManifestSummary(candidateDirectory);
    if (candidateManifest?.applicationSurfaceSlot !== 'knowledge-base') return [];
    const candidateSourceKind: 'official-source' | 'direct' | 'active' = !packaged && isDevelopmentPluginDirectory(candidateDirectory, roots.developmentRoot)
      ? 'official-source'
      : backendDirectDirs.some(value => path.resolve(value) === path.resolve(candidateDirectory))
        ? 'direct'
        : 'active';
    return isTrustedPluginSource({
      pluginId: candidateId,
      pluginDir: candidateDirectory,
      version: candidateManifest.version,
      sourceKind: candidateSourceKind,
    }, {
      packaged,
      workspaceRoot: roots.developmentRoot,
      backendDirectDirs,
      bundledPluginRoot: process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT,
      getRegisteredPluginDirectory: getRegisteredBackendPluginDirectory,
    }) ? [candidateId] : [];
  });
  if (trustedPluginIds.length !== 1) {
    if (trustedPluginIds.length > 1) {
      pluginDiagnostics.record({
        level: 'error',
        pluginId,
        capability: null,
        message: `多个可信插件申请知识库资料接管，已拒绝全部来源（count=${trustedPluginIds.length}）`,
      });
    }
    return false;
  }
  return trustedPluginIds[0] === pluginId && isTrustedPluginSource(
    {
      pluginId,
      pluginDir: directory,
      version: manifest.version,
      sourceKind,
    },
    {
      packaged,
      workspaceRoot: roots.developmentRoot,
      backendDirectDirs,
      bundledPluginRoot: process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT,
      getRegisteredPluginDirectory: getRegisteredBackendPluginDirectory,
    }
  );
}
