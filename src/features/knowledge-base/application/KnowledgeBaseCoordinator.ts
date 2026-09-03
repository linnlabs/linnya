/**
 * @file src/knowledge-base/application/KnowledgeBaseCoordinator.ts
 *
 * @brief 知识库协调器 - 组织协调各个业务服务
 *
 * @description
 * 功能 (What): 作为知识库服务的协调层，负责参数校验和服务编排
 * 输入 (Input): 各种知识库操作请求参数
 * 输出 (Output): 协调各服务后的操作结果
 * 副作用 (Side-effects): 通过组合的服务完成复杂业务操作
 */

import { Document } from '../domain/document';
import { KnowledgeBase } from '../domain/knowledgeBase';
import {
  KnowledgeBaseService,
  TaskStatusView,
  SearchResponse,
  KnowledgeBaseSearchRequest,
  DocumentSearchRequest,
  ResolvedKnowledgeBaseSearchRequest,
  KnowledgeBaseWithDocumentCount,
} from './knowledgeBaseService';

// 导入所有子服务
import {
  DocumentService,
  TaskService,
  IngestionService,
  KnowledgeBaseMgmtService,
  DocumentServiceDeps,
  IngestionServiceDeps,
  KnowledgeBaseMgmtServiceDeps,
} from './services';

// 导入搜索服务（类型）
import type { SearchService } from './searchService';

// 导入基础设施层
import { MetadataRepository } from '../infrastructure/metadataRepository';
import { QdrantRepository } from '../infrastructure/qdrantRepository';
import { SotRepository } from '../infrastructure/sotRepository';
import type { OriginalDocumentRepository } from '../infrastructure/originalDocumentRepository';
import type { KnowledgeGraphRepository } from '../graph/infrastructure/knowledgeGraphRepository';
import {
  GraphSearchService,
  type GraphAugmentation,
  type GraphEvidenceRef,
} from '../graph/application/graphSearchService';
import type { StatusUpdatePublisher } from '../ingestion/definitions/statusUpdate';
import type { EmbeddingPort, TextGenerationPort } from 'src/domains/model-inference';
import { IngestionStateMachineManager } from '../ingestion/IngestionStateMachineManager';
import { continueFailedPdfPages } from './orchestration/continueFailedPdfPages';
import { getDefaultModelIdByCapability } from 'src/domains/model-catalog';

// 🔥 新增：导入启动清理功能
import { performStartupCleanup } from '../ingestion/failureCleanup';
import { Logger } from 'src/shared/logger';
import { formatSearchResultsForLLM } from '../utils/searchUtils';
import type { KnowledgeBaseGraphSearchOptions } from './knowledgeBaseService';
import type { DocumentOcrPort } from 'src/domains/document-ocr';
import {
  allocateAgentKnowledgeSearchEvidence,
  type AgentKnowledgeSearchOutput,
} from './search/agentSearchOutput';
import type { CitationRefAllocatorPort } from 'src/domains/citation';

const logger = new Logger('KnowledgeBaseCoordinator');

/**
 * 协调器依赖接口
 */
export interface KnowledgeBaseCoordinatorDeps {
  metadataRepository: MetadataRepository;
  qdrantRepository: QdrantRepository;
  sotRepository: SotRepository;
  originalDocumentRepository: OriginalDocumentRepository;
  searchService: SearchService;
  knowledgeGraphRepository: KnowledgeGraphRepository;
  statusUpdatePublisher?: StatusUpdatePublisher;
  ingestionCapabilities?: {
    embedding: EmbeddingPort;
    textGeneration: TextGenerationPort;
    documentOcr: DocumentOcrPort;
  };
}

/**
 * 功能 (What): 知识库协调器类，组织各个业务服务完成复杂操作
 * 输入 (Input): 依赖注入的各种Repository和服务
 * 输出 (Output): 知识库服务接口的完整实现
 * 副作用 (Side-effects): 协调多个服务，确保业务逻辑的正确执行
 */
export class KnowledgeBaseCoordinator implements KnowledgeBaseService {
  private readonly metadataRepository: MetadataRepository;
  private readonly qdrantRepository: QdrantRepository;
  private readonly sotRepository: SotRepository;
  private readonly originalDocumentRepository: OriginalDocumentRepository;
  private readonly searchService: SearchService;
  private readonly knowledgeGraphRepository: KnowledgeGraphRepository;
  private readonly ingestionCapabilities?: KnowledgeBaseCoordinatorDeps['ingestionCapabilities'];

  // 子服务实例
  private readonly documentService: DocumentService;
  private readonly taskService: TaskService;
  private readonly ingestionService: IngestionService;
  private readonly knowledgeBaseMgmtService: KnowledgeBaseMgmtService;

  constructor(deps: KnowledgeBaseCoordinatorDeps) {
    this.metadataRepository = deps.metadataRepository;
    this.qdrantRepository = deps.qdrantRepository;
    this.sotRepository = deps.sotRepository;
    this.originalDocumentRepository = deps.originalDocumentRepository;
    this.searchService = deps.searchService;
    this.knowledgeGraphRepository = deps.knowledgeGraphRepository;
    this.ingestionCapabilities = deps.ingestionCapabilities;

    // 初始化子服务
    const documentServiceDeps: DocumentServiceDeps = {
      metadataRepository: this.metadataRepository,
      qdrantRepository: this.qdrantRepository,
      sotRepository: this.sotRepository,
      originalDocumentRepository: this.originalDocumentRepository,
      knowledgeGraphRepository: this.knowledgeGraphRepository,
    };
    this.documentService = new DocumentService(documentServiceDeps);

    this.taskService = new TaskService({ metadataRepository: this.metadataRepository });

    const ingestionCapabilities = deps.ingestionCapabilities;
    const ingestionServiceDeps: IngestionServiceDeps = {
      metadataRepository: this.metadataRepository,
      originalDocumentRepository: this.originalDocumentRepository,
      statusUpdatePublisher: deps.statusUpdatePublisher,
      createNonWorkerIngestionProcessor: ingestionCapabilities
        ? options =>
            IngestionStateMachineManager.create({
              ...options,
              embedding: ingestionCapabilities.embedding,
              textGeneration: ingestionCapabilities.textGeneration,
              documentOcr: ingestionCapabilities.documentOcr,
              repositories: {
                metadataRepository: this.metadataRepository,
                qdrantRepository: this.qdrantRepository,
                sotRepository: this.sotRepository,
                originalDocumentRepository: this.originalDocumentRepository,
                knowledgeGraphRepository: deps.knowledgeGraphRepository,
              },
            })
        : undefined,
    };
    this.ingestionService = new IngestionService(ingestionServiceDeps);

    const knowledgeBaseMgmtServiceDeps: KnowledgeBaseMgmtServiceDeps = {
      metadataRepository: this.metadataRepository,
      qdrantRepository: this.qdrantRepository,
      sotRepository: this.sotRepository,
      originalDocumentRepository: this.originalDocumentRepository,
    };
    this.knowledgeBaseMgmtService = new KnowledgeBaseMgmtService(knowledgeBaseMgmtServiceDeps);

    logger.info('[KnowledgeBaseCoordinator] 知识库协调器已初始化');
  }

  /**
   * **功能 (What):** 创建新的知识库
   * **输入 (Input):** 知识库名称和可选描述
   * **输出 (Output):** 创建的知识库对象
   * **副作用 (Side-effects):** 在元数据数据库中创建知识库记录，在向量数据库中创建对应集合
   */
  async createKnowledgeBase(name: string, description?: string): Promise<KnowledgeBase> {
    // 说明：Coordinator 只负责编排，具体 KB 创建逻辑下沉到 KnowledgeBaseMgmtService
    return this.knowledgeBaseMgmtService.createKnowledgeBase(name, description);
  }

  /**
   * **功能 (What):** 获取所有知识库列表
   * **输入 (Input):** 无
   * **输出 (Output):** 知识库数组
   * **副作用 (Side-effects):** 查询元数据数据库
   */
  async getAllKnowledgeBases(): Promise<KnowledgeBaseWithDocumentCount[]> {
    return this.knowledgeBaseMgmtService.getAllKnowledgeBases();
  }

  /**
   * **功能 (What):** 获取或创建默认知识库
   * **输入 (Input):** 无
   * **输出 (Output):** 默认知识库对象
   * **副作用 (Side-effects):** 如果默认知识库不存在则创建它
   */
  async getOrCreateDefaultKnowledgeBase(): Promise<KnowledgeBase> {
    return this.knowledgeBaseMgmtService.getOrCreateDefaultKnowledgeBase();
  }

  async getKnowledgeBaseById(kbId: string): Promise<KnowledgeBase | undefined> {
    return this.knowledgeBaseMgmtService.getKnowledgeBaseById(kbId);
  }

  // 文档相关操作 - 委托给DocumentService
  async addDocument(
    kbId: string,
    filePath: string,
    fileName: string,
    fileSize: number,
    embeddingModelId: string,
    pdfOcrModelId?: string,
    imageVisionModelId?: string,
    rerankModelId?: string,
    forceVisionMode?: boolean, // 🔥 修复：添加缺失的forceVisionMode参数
    graphExtractionModelId?: string
  ): Promise<{ taskId: string; document: Document }> {
    return this.ingestionService.addDocument(
      kbId,
      filePath,
      fileName,
      fileSize,
      embeddingModelId,
      pdfOcrModelId,
      imageVisionModelId,
      rerankModelId,
      forceVisionMode,
      graphExtractionModelId
    );
  }

  async getDocumentsInKnowledgeBase(kbId: string): Promise<Document[]> {
    return this.documentService.getDocumentsInKnowledgeBase(kbId);
  }

  async getDocumentById(docId: string): Promise<Document | undefined> {
    return this.documentService.getDocumentById(docId);
  }

  async getTasksStatus(docIds: string[]): Promise<Record<string, TaskStatusView>> {
    return this.documentService.getTasksStatus(docIds);
  }

  async deleteDocument(kbId: string, docId: string): Promise<void> {
    // 删除生命周期编排：
    // 1) 先取消后台任务（摄入/图谱抽取），避免删除后 worker 继续写回
    // 2) 再执行真正的数据删除（向量库/SoT/图谱/元数据）
    // 3) 最后刷新 KB 级图谱进度（前端能立即看到变化）
    await this.taskService.cancelTasksForDocumentDeletion(kbId, docId);
    await this.documentService.deleteDocument(kbId, docId);
    await this.taskService.refreshKbGraphProgress(kbId);
  }

  async continueFailedPdfPages(
    kbId: string,
    docId: string,
    options?: {
      pdfOcrModelId?: string | null;
      embeddingModelId?: string | null;
    }
  ) {
    if (!this.ingestionCapabilities) {
      throw new Error('缺少知识库推理能力，无法继续解析 PDF 失败页');
    }

    return continueFailedPdfPages(
      {
        metadataRepository: this.metadataRepository,
        sotRepository: this.sotRepository,
        qdrantRepository: this.qdrantRepository,
        originalDocumentRepository: this.originalDocumentRepository,
        embedding: this.ingestionCapabilities.embedding,
        textGeneration: this.ingestionCapabilities.textGeneration,
        documentOcr: this.ingestionCapabilities.documentOcr,
        resolveModelByCapability: getDefaultModelIdByCapability,
      },
      kbId,
      docId,
      options
    );
  }

  // 任务控制操作 - 委托给TaskService
  async cancelTask(taskId: string): Promise<void> {
    return this.taskService.cancelTask(taskId);
  }

  async pauseTask(taskId: string): Promise<void> {
    return this.taskService.pauseTask(taskId);
  }

  async resumeTask(taskId: string): Promise<void> {
    return this.taskService.resumeTask(taskId);
  }

  /**
   * **功能 (What):** 删除一个知识库及其包含的所有文档和数据
   * **输入 (Input):** 知识库ID
   * **输出 (Output):** Promise<void>
   * **副作用 (Side-effects):** 删除知识库的所有相关数据
   */
  async deleteKnowledgeBase(kbId: string): Promise<void> {
    // 删除生命周期编排：
    // - 先取消该 KB 下所有后台任务（摄入/图谱抽取），避免删除期间出现写回竞态；
    // - 再删除 KB 及其全部数据（向量库/SoT/元数据/图谱）。
    const documents = await this.metadataRepository.getDocumentsInKnowledgeBase(kbId);
    const docIds = documents.map(d => d.id);
    await this.taskService.cancelTasksForKnowledgeBaseDeletion(kbId, docIds);
    await this.knowledgeBaseMgmtService.deleteKnowledgeBase(kbId);
  }

  /**
   * 更新知识库的基础信息 / 模型配置 / 标签
   */
  async updateKnowledgeBaseSettings(
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
  ): Promise<KnowledgeBase> {
    return this.knowledgeBaseMgmtService.updateKnowledgeBaseSettings(kbId, payload);
  }

  // 搜索相关操作 - 委托给SearchService
  async search(request: KnowledgeBaseSearchRequest): Promise<SearchResponse> {
    // 说明：对外统一使用 KnowledgeBaseSearchRequest；
    // 内部会解析 kbId（缺省时使用 default）并委托给 SearchService。
    return this.searchKnowledgeBase(request);
  }

  /**
   * 在整个知识库中搜索
   * @param request 知识库搜索请求
   * @returns 搜索响应
   */
  async searchKnowledgeBase(request: KnowledgeBaseSearchRequest): Promise<SearchResponse> {
    logger.info(`执行知识库搜索: ${request.query} (知识库: ${request.kbId || 'default'})`);

    try {
      // 如果没有指定知识库ID，使用默认知识库
      const kbId = request.kbId || 'default';

      // 确保默认知识库存在
      if (kbId === 'default') {
        await this.getOrCreateDefaultKnowledgeBase();
      }

      // 转换为内部（已解析 kbId）的搜索请求格式
      const searchRequest: ResolvedKnowledgeBaseSearchRequest = {
        query: request.query,
        kbId,
        topK: request.topK || 5,
        filter: request.filter,
        useReranking: request.useReranking !== false,
        embeddingModelId: request.embeddingModelId ?? null,
        rerankModelId: request.rerankModelId ?? null,
      };

      const response = await this.searchService.search(searchRequest);
      logger.info(`知识库搜索完成，返回 ${response.results.length} 个结果`);
      return response;
    } catch (error) {
      logger.error(`知识库搜索失败: ${error}`);
      throw error;
    }
  }

  /**
   * 在指定文档中搜索
   * @param request 文档搜索请求
   * @returns 搜索响应
   */
  async searchInDocument(request: DocumentSearchRequest): Promise<SearchResponse> {
    logger.info(`执行文档内搜索: ${request.query} (文档: ${request.docId})`);

    try {
      // 获取文档信息以确定所属知识库
      const document = await this.metadataRepository.getDocumentById(request.docId);
      if (!document) {
        throw new Error(`未找到文档: ${request.docId}`);
      }

      // 转换为内部（已解析 kbId）的搜索请求格式
      // 说明：文档内搜索通过 filter.docIds 将检索范围限制在该文档中
      const searchRequest: ResolvedKnowledgeBaseSearchRequest = {
        query: request.query,
        kbId: document.kbId,
        topK: request.topK || 5,
        filter: {
          docIds: [request.docId],
          blockTypes: request.filter?.blockTypes,
          pageRange: request.filter?.pageRange,
        },
        useReranking: request.useReranking !== false,
        embeddingModelId: null,
        rerankModelId: null,
      };

      const response = await this.searchService.search(searchRequest);
      logger.info(`文档内搜索完成，返回 ${response.results.length} 个结果`);
      return response;
    } catch (error) {
      logger.error(`文档内搜索失败: ${error}`);
      throw error;
    }
  }

  async getSoTDocumentForAgent(
    docId: string,
    startPage?: number,
    endPage?: number
  ): Promise<string> {
    logger.info(`为Agent获取SoT文档: ${docId} (页面: ${startPage}-${endPage})`);

    try {
      const sotData = await this.sotRepository.get(docId);
      if (!sotData) {
        throw new Error(`未找到文档 ${docId} 的SoT数据`);
      }

      // 这里可以根据startPage和endPage进行分页处理
      // 当前简化实现返回完整内容
      logger.info(`SoT文档获取成功: ${docId}`);

      // 从content_blocks中提取文本内容
      const blocks = Object.values(sotData.content_blocks || {});
      const textContent = blocks
        .map(block => block.text || '') // `text` 是当前 SoT BlockSchema 的权威内容字段。
        .filter(content => content.trim().length > 0)
        .join('\n\n');

      return textContent;
    } catch (error) {
      logger.error(`获取SoT文档失败: ${error}`);
      throw error;
    }
  }

  /**
   * **功能 (What):** 获取文档内容，支持分页
   * **输入 (Input):** 文档ID，起始页码，结束页码
   * **输出 (Output):** 文档内容
   * **副作用 (Side-effects):** 读取SoT存储库
   */
  async getDocumentContent({
    docId,
    startPage = 1,
    endPage = 1,
  }: {
    docId: string;
    startPage?: number;
    endPage?: number;
  }): Promise<string> {
    logger.info(`获取文档内容: ${docId} (页码: ${startPage}-${endPage})`);

    try {
      const sotData = await this.sotRepository.get(docId);
      if (!sotData) {
        throw new Error(`未找到文档 ${docId} 的SoT数据`);
      }

      const blocks = Object.values(sotData.content_blocks || {});

      // 🔥 修复: 检查文档是否真的有分页信息, page_num 必须是数字
      const isPaginated = blocks.some(block => typeof block.source_info?.page_num === 'number');

      let blocksToProcess: any[];

      if (isPaginated) {
        // --- 对于有分页的文档，使用原逻辑 ---
        const filteredBlocks = blocks.filter(block => {
          const pageNum = block.source_info?.page_num;
          // 🔥 修复: 确保 pageNum 是一个有效的数字
          if (typeof pageNum !== 'number') return false;
          return pageNum >= startPage && pageNum <= endPage;
        });

        if (filteredBlocks.length === 0) {
          return `文档 ${docId} 的页码 ${startPage}-${endPage} 没有内容。`;
        }

        filteredBlocks.sort((a, b) => {
          const aPage = a.source_info?.page_num || 0;
          const bPage = b.source_info?.page_num || 0;
          if (aPage !== bPage) return aPage - bPage;

          const aPos = a.source_info?.position?.y || 0;
          const bPos = b.source_info?.position?.y || 0;
          return aPos - bPos;
        });

        blocksToProcess = filteredBlocks;
      } else {
        // --- 对于无分页的文档 (如.docx) ---
        if (startPage > 1) {
          // 🔥 修复: 使用正确的变量名 startPage
          return `文档 ${docId} 是一个无分页文档，所有内容都在第1页。`;
        }
        blocksToProcess = blocks;
      }

      if (blocksToProcess.length === 0) {
        return `文档 ${docId} 中没有可展示的内容。`;
      }

      // 构建文档内容
      let content = `title:${sotData.doc_title || '文档'}\n\n`;

      let currentPage = -1; // 初始化，确保页眉能正确打印
      for (const block of blocksToProcess) {
        // 仅为分页文档添加页眉
        if (isPaginated) {
          const pageNum = block.source_info?.page_num || 0;
          if (pageNum !== currentPage) {
            currentPage = pageNum;
            content += `\n--- 第 ${currentPage} 页 ---\n\n`;
          }
        }

        content += `${block.text || ''}\n\n`;
      }

      const finalContent = content.trim();

      const MAX_CONTENT_LENGTH = 1000; // 定义内容最大长度
      if (finalContent.length > MAX_CONTENT_LENGTH) {
        const truncatedContent = finalContent.substring(0, MAX_CONTENT_LENGTH);
        // 返回被截断的内容和提示信息
        return `${truncatedContent}\n\n[... 内容因过长被截断 ... 请使用 'knowledge_read' 工具分块阅读此文档。]`;
      }

      return finalContent;
    } catch (error) {
      logger.error(`获取文档内容失败: ${error}`);
      throw error;
    }
  }

  async getSoTTableForAgent(docId: string, blockId: string, maxRows: number = 10): Promise<string> {
    logger.info(`为Agent获取SoT表格: ${docId}/${blockId} (最大行数: ${maxRows})`);

    try {
      const sotData = await this.sotRepository.get(docId);
      if (!sotData) {
        throw new Error(`未找到文档 ${docId} 的SoT数据`);
      }

      // 这里需要根据blockId找到对应的表格数据
      // 当前简化实现返回空字符串
      logger.info(`SoT表格获取成功: ${docId}/${blockId}`);
      return '';
    } catch (error) {
      logger.error(`获取SoT表格失败: ${error}`);
      throw error;
    }
  }

  /**
   * 执行搜索并返回当前 Qdrant payload 投影
   * @param kbId 知识库ID
   * @param query 查询文本
   * @param topK 返回结果数量
   * @param docIds 文档ID过滤
   * @param useReranking 是否使用重排序
   * @returns 原始payload格式的搜索结果数组
   */
  async searchRawResults(
    kbId: string,
    query: string,
    topK: number = 10,
    docIds?: string[],
    useReranking: boolean = true,
    options?: {
      rerankModelId?: string | null;
    }
  ): Promise<Array<Record<string, unknown>>> {
    logger.info(`执行原始格式搜索: ${query} (知识库: ${kbId})`);

    try {
      // 如果知识库ID是'default'，确保默认知识库存在
      if (kbId === 'default') {
        await this.getOrCreateDefaultKnowledgeBase();
      }

      const results = await this.searchService.searchRawResults(
        kbId,
        query,
        topK,
        docIds,
        useReranking,
        options
      );
      logger.info(`原始格式搜索完成，返回 ${results.length} 个结果`);
      return results;
    } catch (error) {
      logger.error(`原始格式搜索失败: ${error}`);
      throw error;
    }
  }

  /**
   * 为 Agent 执行搜索并返回当前工具输出合同
   * @param kbId 知识库ID
   * @param query 查询文本
   * @param topK 返回结果数量
   * @param docId 可选的文档ID过滤
   * @returns 格式化的搜索结果字符串
   */
  async searchForAgent(
    kbId: string,
    query: string,
    citationRefAllocator: CitationRefAllocatorPort,
    topK: number = 5,
    docId?: string,
    citationOffset: number = 0, // 🔥 新增引用偏移量参数
    graph?: KnowledgeBaseGraphSearchOptions
  ): Promise<AgentKnowledgeSearchOutput> {
    logger.info(`执行Agent搜索: ${query} (知识库: ${kbId}${docId ? `, 文档: ${docId}` : ''})`);

    try {
      // 如果知识库ID是'default'，确保默认知识库存在
      if (kbId === 'default') {
        await this.getOrCreateDefaultKnowledgeBase();
      }

      // 🔥 传递引用偏移量
      const result = await this.searchService.searchForAgent(
        kbId,
        query,
        citationRefAllocator,
        topK,
        docId,
        citationOffset,
        graph
      );
      logger.info(`Agent搜索完成`);
      return result;
    } catch (error) {
      logger.error(`Agent搜索失败: ${error}`);
      throw error;
    }
  }

  /**
   * 为 Agent 在多个知识库上执行聚合搜索（项目关联多知识库场景）
   *
   * 设计要点：
   * - 仅做“全库搜索”聚合（docId 为空）；docId 搜索应由调用方先定位文档所属 kbId 再走单库路径；
   * - 评分字段来源于 searchRawResults 内部追加的 rrf_score / rerank_score；
   * - 最终结果使用 `formatSearchResultsForLLM` 生成统一的 Agent 文本投影。
   */
  async searchForAgentAcrossKnowledgeBases(request: {
    kbIds: string[];
    query: string;
    citationRefAllocator: CitationRefAllocatorPort;
    topK?: number;
    graph?: KnowledgeBaseGraphSearchOptions;
  }): Promise<AgentKnowledgeSearchOutput> {
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
    for (const kbId of normalizedKbIds) {
      try {
        const items = await this.searchService.searchRawResults(kbId, query, topK, undefined, true);
        for (const item of items) {
          // 附加来源 kbId（仅用于调试/排查，不影响格式化输出）
          const mergedItem: Record<string, unknown> = { ...item, _kb_id: kbId };
          merged.push(mergedItem);
        }
      } catch (error) {
        logger.warn(
          `[KnowledgeBaseCoordinator] 聚合搜索：知识库 ${kbId} 搜索失败：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (merged.length === 0) {
      return {
        observation: await formatSearchResultsForLLM(
          [],
          this.sotRepository,
          undefined,
          query,
          0,
          []
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
        observation: await formatSearchResultsForLLM(
          finalResults,
          this.sotRepository,
          undefined,
          query,
          0,
          admitted.refs
        ),
        hits: admitted.hits,
      };
    }

    const refs: Array<{ kbId: string; docId: string; blockId: string }> = [];
    for (const r of finalResults) {
      const kbIdFromItem =
        typeof (r as { _kb_id?: unknown })._kb_id === 'string'
          ? ((r as { _kb_id?: unknown })._kb_id as string)
          : '';
      const docIdRaw = (r as { doc_id?: unknown }).doc_id;
      const blockIdRaw = (r as { block_id?: unknown }).block_id;
      const d = typeof docIdRaw === 'string' ? docIdRaw : '';
      const b = typeof blockIdRaw === 'string' ? blockIdRaw : '';
      if (kbIdFromItem.trim().length === 0 || d.trim().length === 0 || b.trim().length === 0)
        continue;
      refs.push({ kbId: kbIdFromItem, docId: d, blockId: b });
    }

    const graphSearchService = new GraphSearchService(this.knowledgeGraphRepository);
    const augmentations = await graphSearchService.getAugmentationsForEvidenceBlocks(refs);

    return {
      observation: await formatSearchResultsForLLM(
        finalResults,
        this.sotRepository,
        undefined,
        query,
        0,
        admitted.refs,
        {
          graphAugmentations: augmentations,
          graphMode: graph.mode,
          graphBudget: graph.budget,
        }
      ),
      hits: admitted.hits,
    };
  }

  async getGraphAugmentationsForEvidenceBlocks(
    refs: GraphEvidenceRef[],
    options?: {
      enableOneHopExpansion?: boolean;
      maxEdgesPerEntity?: number;
    }
  ): Promise<ReadonlyMap<string, GraphAugmentation>> {
    // 说明：该能力是“结构化 sidecar”，专门给工具链路生成轻量摘要（graph_digest）用。
    // 约束：只读反查，不改变召回/排序。
    const graphSearchService = new GraphSearchService(this.knowledgeGraphRepository);
    return await graphSearchService.getAugmentationsForEvidenceBlocks(refs, options);
  }

  /**
   * 获取文档原始 SoT 数据（供工具做分块阅读等）
   */
  async getRawSoTDocument(docId: string) {
    return this.sotRepository.get(docId);
  }
}
