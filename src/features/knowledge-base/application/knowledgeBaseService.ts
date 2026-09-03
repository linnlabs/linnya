/**
 * @file src/knowledge-base/application/knowledgeBaseService.ts
 *
 * @brief 知识库应用服务接口和主要类型定义
 *
 * @description
 * 该文件定义了知识库的核心应用服务接口，该服务负责编排知识库的各种操作，
 * 包括创建知识库、添加文档、搜索文档内容等。它是业务逻辑的核心部分，
 * 协调领域模型和基础设施层之间的交互。
 */

import { Document, DocumentStatus } from '../domain/document';
import { KnowledgeBase } from '../domain/knowledgeBase';
import type { DocumentSoT } from '../domain/block';
import type { GraphBudget, GraphMode } from '../graph/application/graphBudget';
import type { GraphAugmentation, GraphEvidenceRef } from '../graph/application/graphSearchService';
import type { AgentKnowledgeSearchOutput } from './search/agentSearchOutput';
import type { CitationRefAllocatorPort } from '../../../domains/citation';

/**
 * 知识库搜索的图谱增强选项（对外协议）
 *
 * 说明：
 * - 该选项只控制“输出附加多少图谱信息”，不改变 RAG 的召回/排序；
 * - graph_mode=full 目前仅代表“更大的输出预算”，Entity-Driven/多跳能力后续再接入。
 */
export type KnowledgeBaseGraphSearchOptions = {
  mode: GraphMode;
  budget: GraphBudget;
};

/**
 * 知识库摘要（用于 API / UI 展示）
 *
 * 设计说明：
 * - `KnowledgeBase` 仍然是领域模型，不承载统计字段；
 * - `documentCount` 属于视图/统计信息，因此以“交叉类型”的方式附加在返回结构中。
 */
export type KnowledgeBaseWithDocumentCount = KnowledgeBase & { documentCount: number };

/**
 * 任务状态视图，用于前端展示
 */
export interface TaskStatusView {
  /** 任务ID */
  taskId: string;

  /** 文档ID */
  docId: string;

  /** 任务状态 */
  status: string;

  /** 进度 (0-100) */
  progress: number;

  /** 当前阶段 */
  stage: string;

  /**
   * 阶段内进度（0-100）。
   *
   * 说明：
   * - 该字段用于前端把 stage 映射为 0~100 的绝对进度；
   * - IPC 与轮询接口必须保持一致，否则“校准轮询”会覆盖 IPC 造成进度卡死。
   */
  stage_progress?: number;

  /**
   * 用户可见的状态消息（例如：解析中/已完成/失败原因等）。
   *
   * 说明：
   * - IPC 推送与轮询拉取都应尽可能提供该字段，避免前端出现空白标签或误导文案。
   */
  message?: string;

  /** 错误信息 */
  error?: string;

  /** 更新时间 */
  updatedAt: number;

  /** 预计完成时间 */
  estimatedTimeRemaining?: number;
}

export interface SearchFilter {
  docIds?: string[];
  blockTypes?: string[];
  pageRange?: {
    min: number;
    max: number;
  };
}

export interface KnowledgeBaseSearchRequest {
  kbId?: string; // If not provided, searches the default KB
  query: string;
  topK?: number;
  filter?: SearchFilter;
  useReranking?: boolean;
  embeddingModelId?: string | null;
  rerankModelId?: string | null;
}

/**
 * 已解析的知识库搜索请求（内部使用）
 *
 * 为什么需要它：
 * - 对外 API 的 `KnowledgeBaseSearchRequest.kbId` 允许缺省（代表 default KB）
 * - 但底层 SearchService / Repository 需要明确的 kbId 才能工作
 */
export type ResolvedKnowledgeBaseSearchRequest = Omit<KnowledgeBaseSearchRequest, 'kbId'> & {
  kbId: string;
};

export interface DocumentSearchRequest {
  docId: string;
  query: string;
  topK?: number;
  filter?: Omit<SearchFilter, 'docIds'>;
  useReranking?: boolean;
}

/**
 * @deprecated Use KnowledgeBaseSearchRequest instead. Will be removed soon.
 */
export interface SearchRequest {
  /** 查询文本 */
  query: string;

  /** 知识库ID */
  kbId: string;

  /** 返回结果数量 */
  topK?: number;

  /** 是否使用重排序 */
  useReranking?: boolean;

  /** 文档过滤 */
  docFilter?: string[];

  /** 是否包含全文 */
  includeFullText?: boolean;
}

/**
 * 搜索响应结果
 */
export interface SearchResponse {
  /** 搜索结果 */
  results: Array<{
    /** 文本内容 */
    text: string;

    /** 文档ID */
    docId: string;

    /** 文档名称 */
    docTitle: string;

    /** 分数 */
    score: number;

    /** 匹配类型 */
    matchType: string;

    /** 块类型 */
    blockType: string;

    /** 块ID */
    blockId: string;

    /** 页码 */
    page?: number;
  }>;

  /** 搜索的元信息 */
  meta?: {
    /** 查询处理时间（毫秒） */
    processingTimeMs: number;

    /** 使用的向量模型 */
    vectorModel?: string;

    /** 使用的重排序模型 */
    rerankModel?: string;

    /** 总结果数量 */
    totalResults: number;
  };
}

/**
 * 知识库应用服务接口
 */
export interface KnowledgeBaseService {
  /**
   * 创建知识库
   * @param name 知识库名称
   * @param description 可选的知识库描述
   * @returns 创建的知识库
   */
  createKnowledgeBase(name: string, description?: string): Promise<KnowledgeBase>;

  /**
   * 获取所有知识库
   * @returns 知识库列表
   */
  getAllKnowledgeBases(): Promise<KnowledgeBaseWithDocumentCount[]>;

  /**
   * 获取或创建默认知识库
   * @returns 默认知识库
   */
  getOrCreateDefaultKnowledgeBase(): Promise<KnowledgeBase>;

  /**
   * 添加文档到知识库
   * @param kbId 知识库ID
   * @param filePath 文件路径
   * @param fileName 文件名
   * @param fileSize 文件大小
   * @param embeddingModelId 嵌入模型ID
   * @param pdfOcrModelId 可选的 PDF OCR 模型 ID
   * @param imageVisionModelId 可选的图片视觉模型 ID
   * @param rerankModelId 可选的重排序模型ID
   * @param forceVisionMode 可选的强制视觉模式设置
   * @param graphExtractionModelId 可选的新上传文档图谱抽取模型快照
   * @returns 任务信息，包含文档ID和任务ID
   */
  addDocument(
    kbId: string,
    filePath: string,
    fileName: string,
    fileSize: number,
    embeddingModelId: string,
    pdfOcrModelId?: string,
    imageVisionModelId?: string,
    rerankModelId?: string,
    forceVisionMode?: boolean,
    graphExtractionModelId?: string
  ): Promise<{
    taskId: string;
    document: Document;
  }>;

  /**
   * 获取知识库中的所有文档
   * @param kbId 知识库ID
   * @returns 文档列表
   */
  getDocumentsInKnowledgeBase(kbId: string): Promise<Document[]>;

  /**
   * 根据ID获取单个文档
   * @param docId 文档ID
   * @returns 文档对象或undefined
   */
  getDocumentById(docId: string): Promise<Document | undefined>;

  /**
   * 获取文档任务状态
   * @param docIds 文档ID列表
   * @returns 任务状态映射
   */
  getTasksStatus(docIds: string[]): Promise<Record<string, TaskStatusView>>;

  /**
   * 取消任务
   * @param taskId 任务ID（通常是docId）
   */
  cancelTask(taskId: string): Promise<void>;

  /**
   * 暂停任务
   * @param taskId 任务ID（通常是docId）
   */
  pauseTask(taskId: string): Promise<void>;

  /**
   * 恢复任务
   * @param taskId 任务ID（通常是docId）
   */
  resumeTask(taskId: string): Promise<void>;

  /**
   * 删除文档
   * @param kbId 知识库ID
   * @param docId 文档ID
   */
  deleteDocument(kbId: string, docId: string): Promise<void>;

  /**
   * 继续解析 PDF partial 文档的失败页。
   * @param kbId 知识库ID
   * @param docId 文档ID
   */
  continueFailedPdfPages(
    kbId: string,
    docId: string,
    options?: {
      pdfOcrModelId?: string | null;
      embeddingModelId?: string | null;
    }
  ): Promise<{
    docId: string;
    attemptedPages: number[];
    recoveredPages: number[];
    remainingFailedPages: number[];
    addedBlocks: number;
  }>;

  /**
   * 删除知识库
   * @param kbId 知识库ID
   */
  deleteKnowledgeBase(kbId: string): Promise<void>;

  /**
   * 更新知识库的基础信息 / 模型配置 / 标签
   * @param kbId 知识库ID
   * @param payload 允许更新的字段
   */
  updateKnowledgeBaseSettings(
    kbId: string,
    payload: {
      name?: string;
      description?: string | null;
      embeddingModelId?: string | null;
      rerankModelId?: string | null;
      pdfOcrModelId?: string | null;
      imageVisionModelId?: string | null;
      visionModelId?: string | null;
      tags?: string[];
      enableGraphIndexing?: boolean;
    }
  ): Promise<KnowledgeBase>;

  /**
   * 搜索知识库
   * @param request 搜索请求
   * @returns 搜索结果
   */
  search(request: KnowledgeBaseSearchRequest): Promise<SearchResponse>;

  /**
   * Searches across the entire knowledge base.
   * @param request The search request details.
   * @returns The search results.
   */
  searchKnowledgeBase(request: KnowledgeBaseSearchRequest): Promise<SearchResponse>;

  /**
   * Searches within a specific document.
   * @param request The search request details for a single document.
   * @returns The search results.
   */
  searchInDocument(request: DocumentSearchRequest): Promise<SearchResponse>;

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

  /**
   * 为 Agent 执行搜索并返回当前工具输出合同
   * @param kbId 知识库ID
   * @param query 查询文本
   * @param topK 返回结果数量
   * @param docId 可选的文档ID过滤
   * @returns 格式化的搜索结果字符串
   */
  searchForAgent(
    kbId: string,
    query: string,
    citationRefAllocator: CitationRefAllocatorPort,
    topK?: number,
    docId?: string,
    citationOffset?: number, // 🔥 新增引用偏移量参数
    graph?: KnowledgeBaseGraphSearchOptions
  ): Promise<AgentKnowledgeSearchOutput>;

  /**
   * 为 Agent 在多个知识库上执行聚合搜索（项目关联多知识库场景）
   *
   * 说明：
   * - 仅用于“全库搜索”（docId 为空）；
   * - 聚合策略：按各知识库返回的评分字段进行统一排序，最终截断到 topK。
   */
  searchForAgentAcrossKnowledgeBases(request: {
    kbIds: string[];
    query: string;
    citationRefAllocator: CitationRefAllocatorPort;
    topK?: number;
    graph?: KnowledgeBaseGraphSearchOptions;
  }): Promise<AgentKnowledgeSearchOutput>;

  /**
   * 批量按“证据块（docId/blockId）”反查软图谱增强信息（结构化）。
   *
   * 设计意图（根因说明）：
   * - 过去图谱信息只出现在 `formatSearchResultsForLLM` 的 observation 文本中；
   * - deep_search 的最终产物来自 `assemble_documents`（结构化输出），上层 AI 看不到图谱；
   * - 因此提供一个“可被工具链路调用”的结构化接口，用于生成轻量摘要（graph_digest）而不透出 full graph。
   *
   * 注意：
   * - 该接口不改变检索召回/排序，只做 evidence -> graph 的只读反查；
   * - 若文档图谱尚未完成（status=queued/failed 等），可能返回空 map（表示无可用图谱）。
   */
  getGraphAugmentationsForEvidenceBlocks(
    refs: GraphEvidenceRef[],
    options?: {
      /** 是否启用 1-hop 邻接扩展（Light V2 能力）。默认 false，避免摘要体积膨胀。 */
      enableOneHopExpansion?: boolean;
      /** 每个实体最多扩展多少条边（仅在 enableOneHopExpansion=true 时生效）。 */
      maxEdgesPerEntity?: number;
    }
  ): Promise<ReadonlyMap<string, GraphAugmentation>>;

  /**
   * 获取文档的原始 SoT 数据（供工具做分块阅读、结构化定位等）
   * @param docId 文档ID
   */
  getRawSoTDocument(docId: string): Promise<DocumentSoT | undefined>;

  /**
   * 为Agent获取文档的SoT数据
   * @param docId 文档ID
   * @param startPage 起始页码
   * @param endPage 结束页码
   * @returns 格式化的文本内容
   */
  getSoTDocumentForAgent(docId: string, startPage?: number, endPage?: number): Promise<string>;

  /**
   * 为Agent获取表格内容
   * @param docId 文档ID
   * @param blockId 块ID
   * @param maxRows 最大行数
   * @returns 格式化的表格内容
   */
  getSoTTableForAgent(docId: string, blockId: string, maxRows?: number): Promise<string>;

  /**
   * 获取文档内容，支持分页
   * @param params 包含文档ID和页码范围的参数对象
   * @returns 格式化的文档内容
   */
  getDocumentContent(params: {
    docId: string;
    startPage?: number;
    endPage?: number;
  }): Promise<string>;
}
