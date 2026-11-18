import type { ApplicationSurfaceCitationSearch } from '@plugin/renderer/pluginContribution';
import type { KnowledgeCitationSearchPort } from '@/domains/editor/features/citation/definitions/knowledgeCitationSearch';
import { getApplicationSurface, listActiveRendererPluginIds, useRendererPluginRegistryRevision } from '../registry';

interface Dependencies {
  /** 当前可用的应用槽资料搜索；槽停用或贡献没有提供时为 null。 */
  readSearch(): ApplicationSurfaceCitationSearch | null;
}

/** 官方插件与 Editor 的装配只放 App；Editor 不知道插件，App 只调应用槽贡献，不知道插件 IPC。 */
export function createKnowledgeCitationSearchPort(dependencies: Dependencies = {
  readSearch: () => {
    void useRendererPluginRegistryRevision().value;
    return getApplicationSurface('knowledge-base', new Set(listActiveRendererPluginIds()))?.contribution.citationSearch ?? null;
  },
}): KnowledgeCitationSearchPort {
  const requireSearch = (signal: AbortSignal): ApplicationSurfaceCitationSearch => {
    signal.throwIfAborted();
    const search = dependencies.readSearch();
    if (!search) throw new Error('知识库插件未启用');
    return search;
  };
  /** 请求期间插件可能被停用；撤销的是当前界面对结果的接纳，不能宣称后端已取消。 */
  const accept = <T>(value: T, signal: AbortSignal): T => {
    signal.throwIfAborted();
    if (!dependencies.readSearch()) throw new Error('知识库插件未启用');
    return value;
  };
  return {
    isAvailable: () => dependencies.readSearch() !== null,
    async listProjectLibraries(projectId, signal) {
      const libraries = await requireSearch(signal).listProjectLibraries(projectId, signal);
      return accept(libraries.map(({ id, name }) => ({ id, name })), signal);
    },
    async searchLibrary(request, signal) {
      const candidates = await requireSearch(signal).searchLibrary(request, signal);
      return accept(candidates.map(candidate => ({ ...candidate })), signal);
    },
  };
}
