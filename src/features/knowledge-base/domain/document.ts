/**
 * @file src/knowledge-base/domain/document.ts
 *
 * @brief [领域模型] 定义文档实体及其相关类型。
 *
 * @description
 * 该模块定义了知识库中文档的核心领域模型，包括文档状态枚举和文档实体。
 * 文档实体包含了文档的基本元数据，如ID、名称、状态等，但不包含实际内容。
 * 实际内容存储在 Source of Truth (SoT) 仓库中。
 */

import { z } from 'zod';

/**
 * 文档处理状态的枚举
 */
export enum DocumentStatus {
  /** 等待处理 */
  PENDING = 'pending',
  
  /** 处理中 */
  PROCESSING = 'processing',
  
  /** 处理完成 */
  COMPLETED = 'completed',
  
  /** 处理失败 */
  FAILED = 'failed',
  
  /** 重复文件 */
  DUPLICATE = 'duplicate'
}

export const DocumentParsePageDiagnosticSchema = z.object({
  pageNumber: z.number().int().positive(),
  errorKind: z.enum([
    'timeout',
    'rate_limited',
    'auth',
    'bad_request',
    'payload_too_large',
    'server',
    'network',
    'empty_content',
    'local_conversion',
    'unknown',
  ]),
  message: z.string(),
  retryable: z.boolean(),
  shouldReduceConcurrency: z.boolean(),
  shouldSplitSmaller: z.boolean(),
});

export const DocumentParseDiagnosticsSchema = z.object({
  parser: z.literal('pdf'),
  pipeline: z.enum([
    'text_extraction',
    'geometric_analysis',
    'vision_document_upload',
    'vision_page_image',
  ]),
  totalPages: z.number().int().nonnegative(),
  parsedPages: z.array(z.number().int().positive()),
  failedPages: z.array(DocumentParsePageDiagnosticSchema),
  isPartial: z.boolean(),
  createdAt: z.number(),
});

export type DocumentParseDiagnostics = z.infer<typeof DocumentParseDiagnosticsSchema>;

/**
 * 文档实体的Zod模式
 */
export const DocumentSchema = z.object({
  /** 文档的唯一ID */
  id: z.string(),
  
  /** 文档所属的知识库ID */
  kbId: z.string(),
  
  /** 文档的文件名 */
  filename: z.string(),
  
  /** 文件大小（字节） */
  fileSize: z.number(),
  
  /** 文档处理状态 */
  status: z.nativeEnum(DocumentStatus),
  
  /** 错误信息（如果处理失败） */
  errorMessage: z.string().optional().nullable(),
  
  /** 创建时间（Unix时间戳） */
  createdAt: z.number(),
  
  /** 更新时间（Unix时间戳） */
  updatedAt: z.number().optional().nullable(),
  
  /** 关联的任务ID */
  taskId: z.string().optional().nullable(),

  /** PDF 解析诊断：用于展示 partial 成功与失败页，不改变 completed 状态语义 */
  parseDiagnostics: DocumentParseDiagnosticsSchema.optional().nullable()
});

/**
 * 文档实体类型
 */
export type Document = z.infer<typeof DocumentSchema>;

/**
 * 创建新文档
 * @param id 文档ID
 * @param kbId 知识库ID
 * @param filename 文件名
 * @param fileSize 文件大小
 * @returns 文档实体
 */
export function createDocument(id: string, kbId: string, filename: string, fileSize: number): Document {
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
    parseDiagnostics: null
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
    errorMessage: status === DocumentStatus.FAILED ? (errorMessage || '未知错误') : null,
    updatedAt: Date.now() / 1000
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
    updatedAt: Date.now() / 1000
  };
}
