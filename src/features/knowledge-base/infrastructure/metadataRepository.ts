/**
 * @file src/features/knowledge-base/infrastructure/metadataRepository.ts
 *
 * @brief 知识库元数据仓储接口定义
 *
 * @description
 * 该文件定义了知识库元数据的存储接口。
 * 
 * 🔥 说明：知识库元数据已统一迁移到 workspace.sqlite（better-sqlite3）。
 * - 新实现：BetterSqliteMetadataRepository (workspace.sqlite / better-sqlite3)
 * - 不再保留旧的 sql.js(metadata.sqlite) 实现
 */

import { KnowledgeBase } from '../domain/knowledgeBase';
import { Document, DocumentParseDiagnostics, DocumentStatus } from '../domain/document';

/**
 * 元数据仓储接口
 */
export interface MetadataRepository {
  /**
   * 创建新的知识库
   * @param kb 知识库数据
   * @returns 创建的知识库
   */
  createKnowledgeBase(kb: KnowledgeBase): Promise<KnowledgeBase>;
  
  /**
   * 获取所有知识库
   * @returns 知识库列表
   */
  getAllKnowledgeBases(): Promise<KnowledgeBase[]>;

  /**
   * 获取指定知识库的文档数量（按 kbId 聚合）
   *
   * 设计说明：
   * - “文档数量”属于视图层/统计信息，不纳入领域模型 KnowledgeBase；
   * - 由基础设施层直接做 COUNT 聚合，避免上层为了计数把所有文档拉回内存。
   *
   * @param kbIds 需要统计的知识库 ID 列表
   * @returns 一个以 kbId 为 key，文档数量为 value 的映射
   */
  getDocumentCountsByKnowledgeBaseIds(kbIds: string[]): Promise<Record<string, number>>;
  
  /**
   * 根据ID获取知识库
   * @param kbId 知识库ID
   * @returns 知识库或undefined
   */
  getKnowledgeBaseById(kbId: string): Promise<KnowledgeBase | undefined>;

  /**
   * 读取知识库向量索引的 embedding 出身事实。
   *
   * 说明：
   * - 这里回答的是“已落盘向量用哪个模型建的”，不是用户偏好；
   * - 空 KB / 未完成首次向量化时可以为 null。
   */
  getKnowledgeBaseEmbeddingProvenance(kbId: string): Promise<string | null>;

  /**
   * 写入知识库向量索引的 embedding 出身事实。
   * 仅在首次成功向量化/明确重建后调用，不用于保存用户偏好。
   */
  setKnowledgeBaseEmbeddingProvenance(kbId: string, embeddingModelId: string): Promise<void>;
  
  /**
   * 删除知识库
   * @param kbId 知识库ID
   * @returns 是否删除成功
   */
  deleteKnowledgeBase(kbId: string): Promise<boolean>;

  /**
   * 更新知识库的基础信息 / 配置
   * @param kbId 知识库ID
   * @param payload 允许更新的字段（名称、描述、模型配置、标签等）
   */
  updateKnowledgeBase(
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
  ): Promise<void>;
  
  /**
   * 添加文档
   * @param doc 文档数据
   * @returns 添加的文档
   */
  addDocument(doc: Document): Promise<Document>;
  
  /**
   * 根据ID获取文档
   * @param docId 文档ID
   * @returns 文档或undefined
   */
  getDocumentById(docId: string): Promise<Document | undefined>;
  
  /**
   * 获取知识库中的所有文档
   * @param kbId 知识库ID
   * @returns 文档列表
   */
  getDocumentsInKnowledgeBase(kbId: string): Promise<Document[]>;
  
  /**
   * 获取所有文档（用于启动清理）
   * @returns 所有文档列表
   */
  getAllDocuments(): Promise<Document[]>;
  
  /**
   * 更新文档状态
   * @param docId 文档ID
   * @param status 新状态
   * @param errorMessage 可选的错误信息
   * @returns 是否更新成功
   */
  updateDocumentStatus(docId: string, status: DocumentStatus, errorMessage?: string): Promise<boolean>;

  /**
   * 写入文档解析诊断。
   *
   * 说明：
   * - 该能力只记录解析事实，不改变文档状态；
   * - partial 成功仍保持 completed，UI/后续续跑通过诊断字段判断失败页。
   */
  updateDocumentParseDiagnostics(docId: string, diagnostics: DocumentParseDiagnostics): Promise<boolean>;
  
  /**
   * 删除文档
   * @param docId 文档ID
   * @returns 是否删除成功
   */
  deleteDocument(docId: string): Promise<boolean>;
  
  /**
   * 关闭数据库连接
   */
  close(): void;
}
