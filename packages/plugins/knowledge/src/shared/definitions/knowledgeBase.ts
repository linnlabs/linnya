import { z } from 'zod';

/**
 * 知识库实体的Zod模式
 */
export const KnowledgeBaseSchema = z.object({
  /** 知识库的唯一ID */
  id: z.string(),

  /** 知识库名称 */
  name: z.string(),

  /** 知识库描述 */
  description: z.string().nullable().optional(),

  /** 知识库标签列表（业务 / 场景标签），来源于数据库中的 tags_json 字段 */
  tags: z.array(z.string()).optional(),

  /**
   * 是否启用“软知识图谱构建”（抽取 + 向量化）
   *
   * 约定：
   * - true：对新文档持续构建图谱
   * - false：停止对新文档构建图谱，但不影响已建立的图谱数据与搜索增强能力
   *
   * 默认值策略（重要）：
   * - 默认关闭（false），只有显式开启才会入队图谱抽取/索引；
   * - 这样可以避免新用户/新知识库在未理解成本前被动消耗 AI 资源。
   */
  enableGraphIndexing: z.boolean().optional().default(false),

  /** 创建时间（ISO字符串） */
  createdAt: z.string().datetime(),

  /** 更新时间（ISO字符串） */
  updatedAt: z.string().datetime(),

  /** 用于嵌入的模型ID */
  embeddingModelId: z.string().optional(),

  /**
   * 用于 PDF OCR / 复杂版面解析的模型 ID
   *
   * 说明：
   * - 主要给 PDF Layer 3 使用；
   * - 典型值是 PaddleOCR 这类文档专用 OCR 模型。
   */
  pdfOcrModelId: z.string().optional().nullable(),

  /**
   * 用于图片识别/描述的视觉模型 ID
   *
   * 说明：
   * - 主要给图片摄入链路使用；
   * - 与 PDF OCR 拆开，避免“为了 PDF 改模型”影响图片解析。
   */
  imageVisionModelId: z.string().optional().nullable(),

  /**
   * 兼容旧字段：历史上知识库只有一个视觉模型配置。
   *
   * 约定：
   * - 新代码应优先使用 `pdfOcrModelId` / `imageVisionModelId`；
   * - 读取旧数据时，允许该字段作为兼容回退来源。
   */
  visionModelId: z.string().optional().nullable(),

  /** 用于重排序的模型ID */
  rerankModelId: z.string().optional().nullable(),
});

/**
 * 知识库实体类型
 */
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;

/** 列表计数是只读投影，不增加存储事实。 */
export const KnowledgeBaseSummarySchema = KnowledgeBaseSchema.extend({ documentCount: z.number() });
export type KnowledgeBaseSummary = z.infer<typeof KnowledgeBaseSummarySchema>;
