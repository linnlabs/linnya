/**
 * @file src/features/knowledge-base/application/search/defaultSearchService.ts
 *
 * @brief DefaultSearchService：SearchService 的默认实现（编排层，保持高内聚低耦合）。
 *
 * 设计说明：
 * - 该类只负责“请求编排”：向量生成 → Qdrant 检索 → 排序/重排 → 过滤孤儿 →（可选）图谱增强 → formatter；
 * - 具体职责下沉到相邻模块：
 *   - QueryVectorBuilder：生成/校验 queryVector
 *   - DefaultSearchRanker：排序/重排
 *   - DocumentExistenceFilter：过滤孤儿 doc_id
 *   - graphEnhancedAgentSearch：仅负责 Agent 格式化输出的软图谱增强
 */

import {
  RerankingFailure,
  type EmbeddingPort,
  type RerankingPort,
} from 'src/domains/model-inference';
import { logger } from '@shared/index';
import type { ResolvedKnowledgeBaseSearchRequest, SearchResponse } from '../knowledgeBaseService';
import type { QdrantRepository, SearchResult } from '../../infrastructure/qdrantRepository';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { SotRepository } from '../../infrastructure/sotRepository';
import type { KnowledgeGraphRepository } from '../../graph/infrastructure/knowledgeGraphRepository';
import { formatSearchResultsForLLM } from '../../utils/searchUtils';

import type {
  RankedRetrievedPoint,
  SearchRanker,
  SearchService,
  SearchServiceOptions,
} from './types';
import { DefaultSearchRanker } from './defaultSearchRanker';
import { KnowledgeBaseEmbeddingMismatchError, QueryVectorBuilder } from './queryVectorBuilder';
import { DocumentExistenceFilter } from './documentExistenceFilter';
import { buildAgentSearchOutputWithGraph } from './graphEnhancedAgentSearch';
import type { KnowledgeBaseGraphSearchOptions } from '../knowledgeBaseService';
import {
  allocateAgentKnowledgeSearchEvidence,
  type AgentKnowledgeSearchOutput,
} from './agentSearchOutput';
import type { CitationRefAllocatorPort } from '../../../../domains/citation';

export class DefaultSearchService implements SearchService {
  private readonly qdrantRepository: QdrantRepository;
  private readonly metadataRepository: MetadataRepository;
  private readonly sotRepository: SotRepository;
  private readonly embedding: EmbeddingPort;
  private readonly reranking: RerankingPort;
  private readonly searchRanker: SearchRanker;
  private readonly knowledgeGraphRepository: KnowledgeGraphRepository | null;

  private readonly queryVectorBuilder: QueryVectorBuilder;
  private readonly documentExistenceFilter: DocumentExistenceFilter;

  constructor(options: SearchServiceOptions) {
    this.qdrantRepository = options.qdrantRepository;
    this.metadataRepository = options.metadataRepository;
    this.sotRepository = options.sotRepository;
    this.embedding = options.embedding;
    this.reranking = options.reranking;
    this.searchRanker = options.searchRanker ?? new DefaultSearchRanker();
    this.knowledgeGraphRepository = options.knowledgeGraphRepository ?? null;

    this.queryVectorBuilder = new QueryVectorBuilder({
      metadataRepository: this.metadataRepository,
      embedding: options.embedding,
    });
    this.documentExistenceFilter = new DocumentExistenceFilter({
      metadataRepository: this.metadataRepository,
    });

    logger.info('[SearchService] 初始化完成');
  }

  /**
   * 处理搜索请求并返回原始结果
   */
  async processSearchRequest(request: ResolvedKnowledgeBaseSearchRequest): Promise<SearchResult> {
    const { query, kbId } = request;
    const topK = request.topK || 10;

    try {
      // 1) 生成查询向量（统一校验 number[]）
      logger.info(`为查询生成嵌入向量: ${query}`);
      const { queryVector } = await this.queryVectorBuilder.buildQueryVectorOrThrow({
        kbId,
        query,
        requestedEmbeddingModelId: request.embeddingModelId,
      });

      // 2) 设置搜索过滤器（如果需要）
      const filter =
        request.filter &&
        (request.filter.docIds?.length ||
          request.filter.blockTypes?.length ||
          request.filter.pageRange)
          ? {
              docIds: request.filter.docIds,
              blockTypes: request.filter.blockTypes,
              pageRange: request.filter.pageRange,
            }
          : undefined;

      // 3) 执行混合搜索
      logger.info(`在知识库 ${kbId} 执行混合搜索`);
      return await this.qdrantRepository.hybridSearch(kbId, query, queryVector, topK, filter);
    } catch (error) {
      if (error instanceof KnowledgeBaseEmbeddingMismatchError) {
        throw error;
      }
      logger.error(`搜索处理失败: ${error}`);
      return {
        semanticResults: [],
        keywordResults: [],
        combinedResults: [],
      };
    }
  }

  /**
   * 执行搜索并返回标准化的搜索响应
   */
  async search(request: ResolvedKnowledgeBaseSearchRequest): Promise<SearchResponse> {
    const startTime = Date.now();

    try {
      // 1) 处理搜索请求，获取原始结果
      const searchResult = await this.processSearchRequest(request);

      // 2) combinedResults 作为“候选集合”（后续会做排序/重排）
      let combinedResults: RankedRetrievedPoint[] = searchResult.combinedResults;

      // 3) 获取知识库信息用于后续处理
      const kb = await this.metadataRepository.getKnowledgeBaseById(request.kbId);

      // 4) 应用智能排序
      combinedResults = await this.searchRanker.applyIntelligentLayeredSorting(
        combinedResults,
        request.query
      );

      // 5) 如果启用了重排序，则应用重排序
      if (request.useReranking !== false) {
        const rerankModelId = request.rerankModelId;
        if (rerankModelId) {
          logger.info(`使用模型 ${rerankModelId} 对结果进行重排序`);
          combinedResults = await this.searchRanker.rerankResults(
            this.reranking,
            rerankModelId,
            request.query,
            combinedResults,
            request.topK
          );
        }
      }

      // 6) 根因修复：过滤掉元数据不存在的 doc_id
      combinedResults =
        await this.documentExistenceFilter.filterResultsByExistingDocuments(combinedResults);

      // 7) 限制返回结果数量
      const finalResults = combinedResults.slice(0, request.topK || 10);

      // 8) 转换结果为标准响应格式
      const response: SearchResponse = {
        results: finalResults.map(result => ({
          text: result.payload.document,
          docId: result.payload.doc_id || '',
          docTitle: result.payload.doc_title || '未知文档',
          score: result.score,
          matchType: result.final_match_type ?? result.match_type ?? 'semantic',
          blockType: result.payload.block_type || '',
          blockId: result.payload.block_id || '',
          page: result.payload.page_number || 0,
        })),
        meta: {
          processingTimeMs: Date.now() - startTime,
          vectorModel:
            (await this.metadataRepository.getKnowledgeBaseEmbeddingProvenance(request.kbId)) ||
            undefined,
          rerankModel:
            request.useReranking !== false ? request.rerankModelId || undefined : undefined,
          totalResults: combinedResults.length,
        },
      };

      return response;
    } catch (error) {
      if (
        error instanceof KnowledgeBaseEmbeddingMismatchError ||
        error instanceof RerankingFailure
      ) {
        throw error;
      }
      logger.error(`搜索失败: ${error}`);
      return {
        results: [],
        meta: {
          processingTimeMs: Date.now() - startTime,
          vectorModel: undefined,
          rerankModel: undefined,
          totalResults: 0,
        },
      };
    }
  }

  /**
   * 为 Agent 执行搜索，返回当前工具合同的格式化文本结果
   */
  async searchForAgent(
    kbId: string,
    query: string,
    citationRefAllocator: CitationRefAllocatorPort,
    topK: number = 5,
    docId?: string,
    citationOffset: number = 0,
    graph?: KnowledgeBaseGraphSearchOptions
  ): Promise<AgentKnowledgeSearchOutput> {
    // 统一生成 queryVector（单一真实来源）：RAG/Discovery/Multi-hop/Anchor 复用
    const { embeddingModelId, queryVector } = await this.queryVectorBuilder.buildQueryVectorOrThrow(
      { kbId, query }
    );

    const docIds = docId ? [docId] : undefined;
    const results = await this.searchRawResults(kbId, query, topK, docIds, true, {
      precomputedQuery: {
        embeddingModelId,
        queryVector,
      },
    });

    // 未注入图谱仓储或业务显式关闭，则完全退化为普通 RAG 输出。
    if (!this.knowledgeGraphRepository || graph?.mode === 'off') {
      const admitted = await allocateAgentKnowledgeSearchEvidence(results, citationRefAllocator);
      return {
        observation: await formatSearchResultsForLLM(
          results,
          this.sotRepository,
          docId,
          query,
          citationOffset,
          admitted.refs
        ),
        hits: admitted.hits,
      };
    }

    const ragResults: Array<Record<string, unknown>> = results;
    return buildAgentSearchOutputWithGraph({
      kbId,
      query,
      topK,
      docId,
      citationOffset,
      graph,
      embeddingModelId,
      queryVector,
      ragResults,
      citationRefAllocator,
      qdrantRepository: this.qdrantRepository,
      metadataRepository: this.metadataRepository,
      sotRepository: this.sotRepository,
      embedding: this.embedding,
      knowledgeGraphRepository: this.knowledgeGraphRepository,
    });
  }

  /**
   * 执行搜索并返回当前 Qdrant payload 投影
   */
  async searchRawResults(
    kbId: string,
    query: string,
    topK: number = 10,
    docIds?: string[],
    useReranking: boolean = true,
    options?: {
      precomputedQuery?: { embeddingModelId: string; queryVector: number[] };
      rerankModelId?: string | null;
    }
  ): Promise<Array<Record<string, unknown>>> {
    try {
      /**
       * 根因修复：
       * - 同一次 searchForAgent 内，RAG 检索与 Graph（Discovery/Multi-hop/Anchor）都需要 queryVector；
       * - 若分别 embed，会造成重复嵌入（性能浪费，日志噪音增加）；
       * - 因此当上层提供 precomputedQuery 时，这里直接复用它走 Qdrant 检索。
       */
      const filter = docIds && docIds.length > 0 ? { docIds } : undefined;

      const searchResult = options?.precomputedQuery
        ? await this.qdrantRepository.hybridSearch(
            kbId,
            query,
            options.precomputedQuery.queryVector,
            topK,
            filter
          )
        : await this.processSearchRequest({
            query,
            kbId,
            topK,
            filter,
            useReranking,
          });

      let combinedResults: RankedRetrievedPoint[] = searchResult.combinedResults;

      combinedResults = await this.searchRanker.applyIntelligentLayeredSorting(
        combinedResults,
        query
      );

      if (useReranking && options?.rerankModelId) {
        logger.info(`原始格式搜索使用模型 ${options.rerankModelId} 对结果进行重排序`);
        combinedResults = await this.searchRanker.rerankResults(
          this.reranking,
          options.rerankModelId,
          query,
          combinedResults,
          topK
        );
      }

      combinedResults =
        await this.documentExistenceFilter.filterResultsByExistingDocuments(combinedResults);

      const finalResults = combinedResults.slice(0, topK);

      // 保留索引 payload，并附加本次排序阶段产生的分数与匹配类型。
      const rawResults: Array<Record<string, unknown>> = [];

      for (const res of finalResults) {
        const finalItem: Record<string, unknown> = { ...res.payload };

        // 这些字段属于当前 raw search result 合同，不写回 Qdrant。
        finalItem['rrf_score'] = res.score;
        finalItem['rerank_score'] = res.rerankScore;
        finalItem['match_type'] = res.match_type ?? 'semantic';
        finalItem['final_match_type'] = res.final_match_type ?? res.match_type ?? 'semantic';

        rawResults.push(finalItem);
      }

      logger.info(`原始格式搜索完成，返回 ${rawResults.length} 个结果`);
      return rawResults;
    } catch (error) {
      logger.error(`原始格式搜索失败: ${error}`);
      throw error;
    }
  }
}
