import path from 'node:path';
import { getRegisteredBackendPluginDirectory } from './registeredPluginDirectories';
import { assertPluginRuntimeEnabled } from './pluginRuntimeAccess';
import { isTrustedKnowledgePluginSource } from './rendererApplicationSurfaceTrust';
import { readBackendDirectPluginDirsFromEnv, readPluginManifestSummary } from 'src/electron-main/plugins/loader/pluginLayout';
import { requireInstalledDistributionIdentity } from 'src/shared/distribution-identity';
import { readInstalledRuntimePathRoots } from 'src/shared/runtime-paths';

/** 既有产品资料只交给同源官方 artifact；meta.builtin 和插件自报 ID 不构成授权。 */
export function assertKnowledgeResourceAdmission(pluginId: string): void {
  assertPluginRuntimeEnabled({ pluginId, pluginName: '知识库', action: '访问知识库资源' });
  const directory = getRegisteredBackendPluginDirectory(pluginId);
  const manifest = directory ? readPluginManifestSummary(directory) : null;
  const roots = readInstalledRuntimePathRoots();
  if (!directory || !manifest || !roots) throw new Error('知识库资源缺少已准入的产品来源');
  const packaged = requireInstalledDistributionIdentity().packaged;
  const backendDirectDirs = packaged ? [] : readBackendDirectPluginDirsFromEnv();
  const sourceKind = !packaged && path.resolve(directory) === path.resolve(roots.developmentRoot, 'packages/plugins/knowledge')
    ? 'official-source' : backendDirectDirs.some(value => path.resolve(value) === path.resolve(directory))
      ? 'direct' : 'active';
  const granted = isTrustedKnowledgePluginSource({
    pluginId, pluginDir: directory, version: manifest.version,
    sourceKind,
  }, {
    packaged, workspaceRoot: roots.developmentRoot, backendDirectDirs,
    bundledPluginRoot: process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT,
    getRegisteredPluginDirectory: getRegisteredBackendPluginDirectory,
  });
  if (!granted) throw new Error('该插件来源不能接管已有知识库资料');
}
