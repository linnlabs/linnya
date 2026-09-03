/**
 * @file src/features/knowledge-base/application/search/defaultSearchRanker.ts
 *
 * @brief DefaultSearchRanker：只负责“排序/重排”两件事（高内聚）。
 *
 * 说明：
 * - 输入/输出使用 `RankedRetrievedPoint`，不允许动态宽对象穿过应用边界。
 * - 该模块不关心 Qdrant/元数据/SoT/图谱，避免耦合扩大。
 */

import { RerankingFailure, type RerankingPort } from 'src/domains/model-inference';
import { logger } from '@shared/index';
import type { RankedRetrievedPoint, SearchRanker } from './types';
import {
  applyIntelligentLayeredSorting,
  type LayeredRankingResult,
} from '../../utils/ranking';

function toRankingRecord(p: RankedRetrievedPoint): LayeredRankingResult {
  return {
    id: p.id,
    score: p.score,
    payload: p.payload,
    match_type: p.match_type ?? 'semantic',
    semantic_score: p.score,
    keyword_score: p.keywordScore,
    rerank_score: p.rerankScore,
  };
}

function toRankedRetrievedPoint(r: LayeredRankingResult): RankedRetrievedPoint {
  return {
    id: r.id,
    score: r.score,
    payload: r.payload,
    match_type: r.match_type,
    final_match_type: r.final_match_type,
    rerankScore: r.rerank_score,
    keywordScore: r.keyword_score,
  };
}

/**
 * 默认的搜索排序器实现
 */
export class DefaultSearchRanker implements SearchRanker {
  /**
   * 对融合的搜索结果应用智能排序（使用核心 ranking 算法）
   */
  async applyIntelligentLayeredSorting(results: RankedRetrievedPoint[], query: string): Promise<RankedRetrievedPoint[]> {
    const rankingResults = results.map(toRankingRecord);
    const sorted = applyIntelligentLayeredSorting(rankingResults, query);
    return sorted.map(toRankedRetrievedPoint);
  }

  /**
   * 使用 AI 重排序模型对搜索结果进行重排（使用核心 ranking 算法）
   */
  async rerankResults(
    reranking: RerankingPort,
    rerankModelId: string | undefined,
    query: string,
    searchResults: RankedRetrievedPoint[],
    topK?: number
  ): Promise<RankedRetrievedPoint[]> {
    if (searchResults.length === 0 || !rerankModelId) return searchResults;

    try {
      const result = await reranking.rerank({
        modelId: rerankModelId,
        query,
        documents: searchResults.map(item => item.payload.document),
        topN: topK,
      });
      return result.ranking.map(item => ({
        ...searchResults[item.originalIndex],
        rerankScore: item.score,
      }));
    } catch (error) {
      if (error instanceof RerankingFailure && error.retryable) {
        logger.warn(`Reranking 暂时不可用，保留已有排序：${error.code}`);
        return searchResults;
      }
      throw error;
    }
  }
}
