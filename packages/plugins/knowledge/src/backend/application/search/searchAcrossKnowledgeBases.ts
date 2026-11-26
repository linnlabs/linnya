import { Logger } from '@plugin/backend/loggingRuntime';
import type { CitationRefAllocatorPort } from '@plugin/backend/citationSourceRuntime';
import type { SearchService } from './types';
import type { SotRepository } from '../../infrastructure/sotRepository';
import type { KnowledgeGraphRepository } from '../../graph/infrastructure/knowledgeGraphRepository';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { KnowledgeBaseGraphSearchOptions } from '../knowledgeBaseService';
import { GraphSearchService } from '../../graph/application/graphSearchService';
import { formatSearchResultsForLLM } from '../../utils/searchUtils';
import {
  allocateAgentKnowledgeSearchEvidence,
  type AgentKnowledgeSearchOutput,
} from './agentSearchOutput';
import { isReasonedSearchFailure } from './reasonedSearchFailure';

const logger = new Logger('KnowledgeBaseCoordinator');

/** 正式多库聚合唯一编排；开发诊断只换召回模式，不另复制排序/引用/格式化规则。 */
export async function searchAcrossKnowledgeBases(
  deps: {
    searchService: Pick<SearchService, 'searchRawResults'>;
    sotRepository: SotRepository;
    knowledgeGraphRepository: KnowledgeGraphRepository;
    metadataRepository: Pick<MetadataRepository, 'getKnowledgeBaseById'>;
  },
  request: {
    kbIds: string[];
    query: string;
    citationRefAllocator: CitationRefAllocatorPort;
    topK?: number;
    graph?: KnowledgeBaseGraphSearchOptions;
  }
): Promise<AgentKnowledgeSearchOutput> {
  const normalizedKbIds = Array.from(
    new Set(
      request.kbIds
        .filter(id => typeof id === 'string')
        .map(id => id.trim())
        .filter(id => id.length > 0)
    )
  );

  const query = request.query;
  const topK = typeof request.topK === 'number' && request.topK > 0 ? request.topK : 5;
  const graph = request.graph;

  if (normalizedKbIds.length === 0) {
    throw new Error('[KnowledgeBaseCoordinator] 当前 scope 没有可搜索的知识库');
  }

  // 1) 汇总所有知识库的候选结果（每个知识库先取 topK 条）
  const merged: Array<Record<string, unknown>> = [];
  const failures: Array<{ kbId: string; error: unknown }> = [];
  for (const kbId of normalizedKbIds) {
    try {
      const items = await deps.searchService.searchRawResults(kbId, query, topK, undefined, true);
      for (const item of items) {
        // 附加来源 kbId（仅用于调试/排查，不影响格式化输出）
        const mergedItem: Record<string, unknown> = { ...item, _kb_id: kbId };
        merged.push(mergedItem);
      }
    } catch (error) {
      failures.push({ kbId, error });
      logger.warn(
        `[KnowledgeBaseCoordinator] 聚合搜索：知识库 ${kbId} 搜索失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // 所有库都失败（例如嵌入模型不可用）时整次失败，把原因交给工具层，而不是返回“没有匹配”。
  if (failures.length === normalizedKbIds.length) {
    throw failures[0].error;
  }
  // 只有部分库失败时照常交出其他库的结果（包括确实没有命中），并在结果末尾写明漏查了哪个库、为什么，
  // 让 Agent 知道结果可能不全、该转告用户什么；不能只写日志。
  const partialFailureNote = await describePartialFailures(failures, deps.metadataRepository);
  const withPartialFailureNote = (observation: string): string =>
    partialFailureNote ? `${observation}\n\n${partialFailureNote}` : observation;

  if (merged.length === 0) {
    return {
      observation: withPartialFailureNote(
        await formatSearchResultsForLLM([], deps.sotRepository, undefined, query, 0, [])
      ),
      hits: [],
    };
  }

  // 2) 统一排序并截断到 topK
  const pickScore = (item: Record<string, unknown>): number => {
    const rerankScore = item['rerank_score'];
    if (typeof rerankScore === 'number' && Number.isFinite(rerankScore)) return rerankScore;
    const rrfScore = item['rrf_score'];
    if (typeof rrfScore === 'number' && Number.isFinite(rrfScore)) return rrfScore;
    return 0;
  };

  merged.sort((a, b) => pickScore(b) - pickScore(a));
  const finalResults = merged.slice(0, topK);
  const admitted = await allocateAgentKnowledgeSearchEvidence(
    finalResults,
    request.citationRefAllocator
  );

  // 3) 复用统一 formatter 输出；若启用图谱增强（非 off），则按证据块反查并附加
  if (!graph || graph.mode === 'off') {
    return {
      observation: withPartialFailureNote(
        await formatSearchResultsForLLM(
          finalResults,
          deps.sotRepository,
          undefined,
          query,
          0,
          admitted.refs
        )
      ),
      hits: admitted.hits,
    };
  }

  const refs: Array<{ kbId: string; docId: string; blockId: string }> = [];
  for (const r of finalResults) {
    const kbIdFromItem = typeof r._kb_id === 'string' ? r._kb_id : '';
    const docIdRaw = r.doc_id;
    const blockIdRaw = r.block_id;
    const d = typeof docIdRaw === 'string' ? docIdRaw : '';
    const b = typeof blockIdRaw === 'string' ? blockIdRaw : '';
    if (kbIdFromItem.trim().length === 0 || d.trim().length === 0 || b.trim().length === 0)
      continue;
    refs.push({ kbId: kbIdFromItem, docId: d, blockId: b });
  }

  const graphSearchService = new GraphSearchService(deps.knowledgeGraphRepository);
  const augmentations = await graphSearchService.getAugmentationsForEvidenceBlocks(refs);

  return {
    observation: withPartialFailureNote(
      await formatSearchResultsForLLM(
        finalResults,
        deps.sotRepository,
        undefined,
        query,
        0,
        admitted.refs,
        {
          graphAugmentations: augmentations,
          graphMode: graph.mode,
          graphBudget: graph.budget,
        }
      )
    ),
    hits: admitted.hits,
  };
}

/**
 * 部分库检索失败的说明，按工具合同用英文。已知原因用 toolMessage（写明重试是否有用、该请用户做什么）；
 * 其他失败只能给诊断原文。库名取自元数据，库已被删除时退回库 ID。
 */
async function describePartialFailures(
  failures: ReadonlyArray<{ kbId: string; error: unknown }>,
  metadataRepository: Pick<MetadataRepository, 'getKnowledgeBaseById'>
): Promise<string | null> {
  if (failures.length === 0) return null;
  const lines = await Promise.all(
    failures.map(async ({ kbId, error }) => {
      const name = (await metadataRepository.getKnowledgeBaseById(kbId))?.name ?? kbId;
      const reason = isReasonedSearchFailure(error)
        ? error.toolMessage
        : error instanceof Error
          ? error.message
          : String(error);
      return `- "${name}": ${reason}`;
    })
  );
  return [
    'Note: some linked knowledge bases could not be searched, so these results may be incomplete.',
    ...lines,
  ].join('\n');
}
