/**
 * @file src/features/knowledge-base/application/search/types.ts
 *
 * @brief SearchService 拆分后的公共类型定义（高内聚：只放“对外协议”和共享类型”）。
 *
 * 设计约束：
 * - 该模块不实现任何业务逻辑，只承载接口/类型；
 * - 通过显式类型（而不是 `as any`）表达“检索点在排序/重排阶段的额外字段”；
 * - 维持 `application/searchService.ts` 的对外导出稳定，避免跨模块耦合。
 */

import type { EmbeddingPort, RerankingPort } from 'src/domains/model-inference';
import type { ResolvedKnowledgeBaseSearchRequest, SearchResponse } from '../knowledgeBaseService';
import type {
  QdrantRepository,
  RetrievedPoint,
  SearchResult,
} from '../../infrastructure/qdrantRepository';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { SotRepository } from '../../infrastructure/sotRepository';
import type { KnowledgeGraphRepository } from '../../graph/infrastructure/knowledgeGraphRepository';
import type { KnowledgeBaseGraphSearchOptions } from '../knowledgeBaseService';
import type { AgentKnowledgeSearchOutput } from './agentSearchOutput';
import type { CitationRefAllocatorPort } from '../../../../domains/citation';

/**
 * 检索点在“排序/重排”阶段的扩展字段（只在内存中存在，不回写到 Qdrant）。
 *
 * 说明：
 * - Qdrant 返回的基础类型为 `RetrievedPoint`；
 * - 排序器/重排器可能附加：
 *   - rerankScore：reranker 输出分数（用于智能分层排序与 python 兼容 payload）
 *   - keywordScore：关键词检索分数（若上游提供；当前可能为 undefined）
 *   - final_match_type：智能分层排序后的最终匹配类型（exact/full_keyword/...）
 */
export type RankedRetrievedPoint = RetrievedPoint & {
  keywordScore?: number;
  rerankScore?: number;
  final_match_type?: string;
};

/**
 * 搜索结果排序服务接口
 */
export interface SearchRanker {
  /**
   * 对融合的搜索结果应用智能排序
   * @param results 搜索结果
   * @param query 查询文本
   * @returns 排序后的结果
   */
  applyIntelligentLayeredSorting(
    results: RankedRetrievedPoint[],
    query: string
  ): Promise<RankedRetrievedPoint[]>;

  /**
   * 使用AI重排序模型对搜索结果进行重排
   * @param reranking 模型推理域暴露的窄重排能力
   * @param rerankModelId 重排序模型ID
   * @param query 查询文本
   * @param searchResults 搜索结果
   * @param topK 返回结果数量
   * @returns 重排序后的结果
   */
  rerankResults(
    reranking: RerankingPort,
    rerankModelId: string | undefined,
    query: string,
    searchResults: RankedRetrievedPoint[],
    topK?: number
  ): Promise<RankedRetrievedPoint[]>;
}

/**
 * 搜索服务接口
 */
export interface SearchService {
  /**
   * 执行搜索
   * @param request 搜索请求
   * @returns 搜索响应
   */
  search(request: ResolvedKnowledgeBaseSearchRequest): Promise<SearchResponse>;

  /**
   * 为 Agent 执行搜索并返回当前工具输出合同
   * @param kbId 知识库ID
   * @param query 查询文本
   * @param topK 返回结果数量
   * @param docId 可选的文档ID过滤
   * @param citationOffset 🔥 引用编号偏移量,用于多次工具调用时保持编号连续
   * @returns 格式化的搜索结果
   */
  searchForAgent(
    kbId: string,
    query: string,
    citationRefAllocator: CitationRefAllocatorPort,
    topK?: number,
    docId?: string,
    citationOffset?: number,
    graph?: KnowledgeBaseGraphSearchOptions
  ): Promise<AgentKnowledgeSearchOutput>;

  /**
   * 处理搜索请求并返回原始结果
   * @param request 搜索请求
   * @returns 搜索结果
   */
  processSearchRequest(request: ResolvedKnowledgeBaseSearchRequest): Promise<SearchResult>;

  /**
   * 执行搜索并返回当前 Qdrant payload 投影
   * @param kbId 知识库ID
   * @param query 查询文本
   * @param topK 返回结果数量
   * @param docIds 文档ID过滤
   * @param useReranking 是否使用重排序
   * @returns 原始payload格式的搜索结果数组
   */
  searchRawResults(
    kbId: string,
    query: string,
    topK: number,
    docIds?: string[],
    useReranking?: boolean,
    options?: {
      rerankModelId?: string | null;
    }
  ): Promise<Array<Record<string, unknown>>>;
}

/**
 * 搜索服务的配置选项
 */
export interface SearchServiceOptions {
  qdrantRepository: QdrantRepository;
  metadataRepository: MetadataRepository;
  sotRepository: SotRepository;
  embedding: EmbeddingPort;
  reranking: RerankingPort;
  searchRanker?: SearchRanker;
  /**
   * 软知识图谱仓储（可选，M5 light 版只在 Agent 格式化输出时附加，不影响基础 search API）
   */
  knowledgeGraphRepository?: KnowledgeGraphRepository;
}
