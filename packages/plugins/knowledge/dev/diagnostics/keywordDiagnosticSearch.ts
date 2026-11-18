import type { SearchService } from '../../src/backend/application/search/types';
import type { MetadataRepository } from '../../src/backend/infrastructure/metadataRepository';
import type { QdrantRepository } from '../../src/backend/infrastructure/qdrantRepository';
import type { SotRepository } from '../../src/backend/infrastructure/sotRepository';
import type { KnowledgeGraphRepository } from '../../src/backend/graph/infrastructure/knowledgeGraphRepository';
import { DocumentExistenceFilter } from '../../src/backend/application/search/documentExistenceFilter';
import { allocateAgentKnowledgeSearchEvidence } from '../../src/backend/application/search/agentSearchOutput';
import { GraphSearchService } from '../../src/backend/graph/application/graphSearchService';
import { formatSearchResultsForLLM } from '../../src/backend/utils/searchUtils';

/** 仅开发命令的显式 --noAi 召回；引用、孤儿过滤和图谱展示仍由正式 owner 处理。 */
export function createKeywordDiagnosticSearch(deps: {
  qdrant: QdrantRepository;
  metadata: MetadataRepository;
  sot: SotRepository;
  graph: KnowledgeGraphRepository;
}): Pick<SearchService, 'searchRawResults' | 'searchForAgent'> {
  const existing = new DocumentExistenceFilter({ metadataRepository: deps.metadata });
  const searchRawResults: SearchService['searchRawResults'] = async (kbId, query, topK, docIds) => {
    const points = await deps.qdrant.keywordSearch(
      kbId,
      query,
      Math.max(1, topK) * 2,
      docIds?.length ? { docIds } : undefined
    );
    const filtered = await existing.filterResultsByExistingDocuments(points);
    return filtered
      .slice(0, topK)
      .map(point => ({
        ...point.payload,
        rrf_score: point.score,
        match_type: point.match_type ?? 'keyword',
        final_match_type: point.match_type ?? 'keyword',
      }));
  };
  return {
    searchRawResults,
    async searchForAgent(kbId, query, allocator, topK = 5, docId, offset = 0, graph) {
      const results = await searchRawResults(kbId, query, topK, docId ? [docId] : undefined, false);
      const admitted = await allocateAgentKnowledgeSearchEvidence(results, allocator);
      const augmentations =
        graph && graph.mode !== 'off'
          ? await new GraphSearchService(deps.graph).getAugmentationsForEvidenceBlocks(
              admitted.hits.map(hit => ({ kbId, docId: hit.docId, blockId: hit.blockId }))
            )
          : undefined;
      return {
        observation: await formatSearchResultsForLLM(
          results,
          deps.sot,
          docId,
          query,
          offset,
          admitted.refs,
          {
            kbId,
            graphAugmentations: augmentations,
            graphMode: graph?.mode,
            graphBudget: graph?.budget,
          }
        ),
        hits: admitted.hits,
      };
    },
  };
}
