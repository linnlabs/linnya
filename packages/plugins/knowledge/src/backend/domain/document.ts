/**
 * @file packages/plugins/knowledge/src/backend/domain/document.ts
 *
 * @brief [领域模型] 定义文档实体及其相关类型。
 *
 * @description
 * 该模块定义了知识库中文档的核心领域模型，包括文档状态枚举和文档实体。
 * 文档实体包含了文档的基本元数据，如ID、名称、状态等，但不包含实际内容。
 * 实际内容存储在 Source of Truth (SoT) 仓库中。
 */

import { DocumentStatus, type KnowledgeDocument as Document } from '@plugin/knowledge/shared';
export {
  DocumentStatus,
  DocumentParsePageDiagnosticSchema,
  DocumentParseDiagnosticsSchema,
  KnowledgeDocumentSchema as DocumentSchema,
  type DocumentParseDiagnostics,
  type KnowledgeDocument as Document,
} from '@plugin/knowledge/shared';

/**
 * 创建新文档
 * @param id 文档ID
 * @param kbId 知识库ID
 * @param filename 文件名
 * @param fileSize 文件大小
 * @returns 文档实体
 */
export function createDocument(
  id: string,
  kbId: string,
  filename: string,
  fileSize: number
): Document {
  return {
    id,
    kbId,
    filename,
    fileSize,
    status: DocumentStatus.PENDING,
    createdAt: Date.now() / 1000,
    errorMessage: null,
    updatedAt: null,
    taskId: null,
    parseDiagnostics: null,
  };
}

/**
 * 更新文档状态
 * @param doc 原始文档
 * @param status 新状态
 * @param errorMessage 可选的错误信息
 * @returns 更新后的文档
 */
export function updateDocumentStatus(
  doc: Document,
  status: DocumentStatus,
  errorMessage?: string
): Document {
  return {
    ...doc,
    status,
    errorMessage: status === DocumentStatus.FAILED ? errorMessage || '未知错误' : null,
    updatedAt: Date.now() / 1000,
  };
}

/**
 * 设置文档的任务ID
 * @param doc 原始文档
 * @param taskId 任务ID
 * @returns 更新后的文档
 */
export function setDocumentTaskId(doc: Document, taskId: string): Document {
  return {
    ...doc,
    taskId,
    updatedAt: Date.now() / 1000,
  };
}
