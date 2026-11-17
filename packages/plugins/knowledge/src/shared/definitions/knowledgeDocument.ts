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
  DUPLICATE = 'duplicate',
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
export const KnowledgeDocumentSchema = z.object({
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
  parseDiagnostics: DocumentParseDiagnosticsSchema.optional().nullable(),
});

/**
 * 文档实体类型
 */
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;

/** 是否有可读原文由资料目录投影，不能另存会漂移的数据库标记。 */
export const KnowledgeDocumentSummarySchema = KnowledgeDocumentSchema.extend({
  hasSource: z.boolean(),
});
export type KnowledgeDocumentSummary = z.infer<typeof KnowledgeDocumentSummarySchema>;
export const KnowledgeSavedContentSchema = z.object({
  documentId: z.string(),
  fileName: z.string(),
  markdown: z.string(),
});
export type KnowledgeSavedContent = z.infer<typeof KnowledgeSavedContentSchema>;
