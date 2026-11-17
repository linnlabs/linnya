import { z } from 'zod';
import { KnowledgeBaseSummarySchema, KnowledgeSearchResponseSchema } from '@plugin/knowledge/shared';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import type { KnowledgeCitationSearchPort } from '@/domains/editor/features/citation/definitions/knowledgeCitationSearch';
import { listActiveRendererPluginIds, useRendererPluginRegistryRevision } from '../registry';

interface Dependencies {
  isAvailable(): boolean;
  invoke(channel: string, payload: unknown): ReturnType<typeof invokeRendererPluginIpc<unknown>>;
}

/** 官方插件与 Editor 的装配只放 App；Editor 不知道插件 IPC 或全局库目录。 */
export function createKnowledgeCitationSearchPort(dependencies: Dependencies = {
  isAvailable: () => {
    void useRendererPluginRegistryRevision().value;
    return listActiveRendererPluginIds().includes('knowledge');
  },
  invoke: (channel, payload) => invokeRendererPluginIpc<unknown>('knowledge', channel, payload),
}): KnowledgeCitationSearchPort {
  const request = async (channel: string, payload: unknown, signal: AbortSignal): Promise<unknown> => {
    signal.throwIfAborted();
    if (!dependencies.isAvailable()) throw new Error('知识库插件未启用');
    const result = await dependencies.invoke(channel, payload);
    // IPC 没有中途取消协议；撤销的是当前界面请求的结果接纳，不能宣称后端已取消。
    signal.throwIfAborted();
    if (!dependencies.isAvailable()) throw new Error('知识库插件未启用');
    if (!result.success) throw new Error(result.error);
    return result.data;
  };
  return {
    isAvailable: dependencies.isAvailable,
    async listProjectLibraries(projectId, signal) {
      const ids = z.array(z.string()).parse(await request('list-project-kb-links', { projectId }, signal));
      if (ids.length === 0) return [];
      const libraries = z.array(KnowledgeBaseSummarySchema).parse(await request('list', {}, signal));
      return libraries.filter(library => ids.includes(library.id)).map(({ id, name }) => ({ id, name }));
    },
    async searchLibrary({ projectId, kbId, query, topK }, signal) {
      // Backend 在读取向量/原文前按冻结的项目再次校验范围；列表不是授权凭证。
      const response = KnowledgeSearchResponseSchema.parse(await request('search', {
        kbId, projectId, request: { query, topK, useReranking: true },
      }, signal));
      return response.results.map(({ docId, docTitle, blockId, page, score, text }) => ({
        docId, docTitle, blockId, page, score, text,
      }));
    },
  };
}
