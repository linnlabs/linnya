/**
 * @file src/tools/knowledgebase/search/shallow/runShallowSearch.ts
 * @description 浅搜索执行器（由 canonical 与内部受限搜索入口共同复用）
 *
 * 设计目标：
 * - 高内聚：把浅搜索的“查询→rawResult→UI解析→citations→StructuredToolResult”收口在一起
 * - 低耦合：只通过 ToolContext/KnowledgeBaseService 与 scope 工具函数通信
 */

import type { ToolContext } from '../../../types';
import type { StructuredToolResult } from '../../../types';
import { KnowledgeSearchResultSchema, type KnowledgeSearchResult } from '@app/schemas';
import { buildCitationMetadataFromResults } from '../types';
import {
  resolveKnowledgeBaseScopeFromContext,
  assertDocumentKbAllowedInScope,
} from '../../scope/projectKnowledgeBaseScope';
import type {
  GraphBudget,
  GraphMode,
} from '../../../../features/knowledge-base/graph/application/graphBudget';
import { captureShallowKnowledgeSearchEvidence } from '../knowledgeSearchEvidenceAdapter';
import { requireCitationRefAllocator } from '../../../../domains/citation';

export async function runShallowSearch(params: {
  query: string;
  docId?: string;
  topK: number;
  context: ToolContext;
  citationOffset: number;
  graph?: { mode: GraphMode; budget: GraphBudget };
}): Promise<StructuredToolResult<KnowledgeSearchResult['data']>> {
  const { query, docId, topK, context, citationOffset, graph } = params;
  const { knowledgeBaseService } = context;
  if (!knowledgeBaseService) {
    throw new Error('Knowledge base service not available');
  }

  // 统一解析"工具作用域"：项目对话时限定到项目关联知识库
  const scope = resolveKnowledgeBaseScopeFromContext(context);
  const citationRefAllocator = requireCitationRefAllocator(context);

  // 根据是否有 docId 决定搜索模式
  let searchOutput: Awaited<ReturnType<typeof knowledgeBaseService.searchForAgent>>;
  let docName: string | null = null;

  if (docId) {
    // 单文档搜索模式
    // 获取文档名称用于UI展示
    const docMetadata = await knowledgeBaseService.getDocumentById(docId);
    docName = docMetadata?.filename || docId;
    if (!docMetadata) {
      throw new Error(`Document with ID '${docId}' not found.`);
    }

    // 项目对话：禁止跨项目知识库读取/搜索
    assertDocumentKbAllowedInScope(scope, docMetadata.kbId, docId);

    searchOutput = await knowledgeBaseService.searchForAgent(
      docMetadata.kbId,
      query,
      citationRefAllocator,
      topK,
      docId,
      citationOffset,
      graph
    );
  } else {
    // 全库搜索模式
    // 项目对话：对"项目关联的多个知识库"做聚合搜索；非项目对话：回退为单库搜索
    if (scope.kbIds.length > 1) {
      searchOutput = await knowledgeBaseService.searchForAgentAcrossKnowledgeBases({
        kbIds: scope.kbIds,
        query,
        citationRefAllocator,
        topK,
        graph,
      });
    } else {
      searchOutput = await knowledgeBaseService.searchForAgent(
        scope.kbIds[0],
        query,
        citationRefAllocator,
        topK,
        undefined,
        citationOffset,
        graph
      );
    }
  }

  const documents = searchOutput.hits.map(hit => ({
    ref: hit.ref,
    doc_id: hit.docId,
    block_id: hit.blockId,
    doc_name: hit.docName,
    snippet: hit.snippet,
    ...(hit.pageNumber === undefined ? {} : { page: hit.pageNumber }),
  }));

  const searchMode: 'global' | 'document' = docId ? 'document' : 'global';

  const citations = buildCitationMetadataFromResults(
    documents,
    query,
    searchMode,
    docName ?? undefined,
    citationOffset
  );

  const result: KnowledgeSearchResult = {
    data: {
      query,
      search_strategy: 'shallow',
      search_mode: searchMode,
      doc_name: docName,
      citations,
    },
    observation: searchOutput.observation,
  };
  const admittedResult = KnowledgeSearchResultSchema.parse(result);
  await captureShallowKnowledgeSearchEvidence({ result: admittedResult, context });
  return admittedResult;
}
