import { z } from 'zod';
import type { ApplicationSurfaceCitationSearch } from '@plugin/renderer/pluginContribution';
import { KnowledgeBaseSummarySchema, KnowledgeSearchResponseSchema } from '../../shared';
import { invokeKnowledgeRequest } from '../services/knowledgeRequestSession';
import { readProjectKnowledgeBaseIds } from '../services/knowledgeProjectLinks';

/**
 * 编辑器引用面板的资料搜索。列表只决定面板里能选哪些库，不是授权凭证：
 * Backend 在读取向量/原文前按冻结的项目再次校验范围。
 */
export const knowledgeCitationSearch: ApplicationSurfaceCitationSearch = {
  async listProjectLibraries(projectId, signal) {
    const ids = await readProjectKnowledgeBaseIds(projectId, signal);
    if (ids.length === 0) return [];
    const libraries = z.array(KnowledgeBaseSummarySchema).parse(await invokeKnowledgeRequest('list', {}, signal));
    return libraries.filter(library => ids.includes(library.id)).map(({ id, name }) => ({ id, name }));
  },
  async searchLibrary({ projectId, kbId, query, topK }, signal) {
    const response = KnowledgeSearchResponseSchema.parse(await invokeKnowledgeRequest('search', {
      kbId, projectId, request: { query, topK, useReranking: true },
    }, signal));
    return response.results.map(({ docId, docTitle, blockId, page, score, text }) => ({
      docId, docTitle, blockId, page, score, text,
    }));
  },
};
