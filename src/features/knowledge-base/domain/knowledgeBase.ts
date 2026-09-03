/**
 * @file src/knowledge-base/domain/knowledgeBase.ts
 *
 * @brief 知识库实体和相关类型定义
 *
 * @description
 * 该文件定义了知识库的核心领域模型，包括知识库实体的数据结构和类型。
 * 知识库是文档的容器，具有自己的元数据和配置信息。
 */

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
  rerankModelId: z.string().optional().nullable()
});

/**
 * 知识库实体类型
 */
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;

/**
 * 默认知识库配置
 */
export const DEFAULT_KB_CONFIG = {
  id: 'default',
  name: '默认知识库',
  description: '用于存储所有未分类文档的默认知识库。',
  tags: [] as string[],
  // 默认关闭图谱构建：需要用户显式开启
  enableGraphIndexing: false,
  // 模型选择是全局用户偏好；KB 表只保留 embedding 索引出身事实。
  embeddingModelId: null as string | null,
  rerankModelId: null as string | null,
  // PDF OCR 默认模型由 agent policy + Model Catalog capability 解析，domain 不持有具体模型 ID。
  pdfOcrModelId: null as string | null,
  // 图片默认使用通用视觉模型，避免与 PDF OCR 耦合
  imageVisionModelId: null as string | null,
  // 兼容旧字段：新建知识库不再写入 PDF OCR 默认 ID，避免未来升级被历史默认值盖住。
  visionModelId: null as string | null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

/**
 * 创建新的知识库
 * @param id 知识库ID
 * @param name 知识库名称
 * @param description 可选的知识库描述
 * @param embeddingModelId 可选的嵌入模型ID
 * @param tags 可选的标签列表
 * @returns 知识库实体
 */
export function createKnowledgeBase(
  id: string,
  name: string,
  description?: string,
  embeddingModelId?: string,
  tags?: string[]
): KnowledgeBase {
  const now = new Date().toISOString();
  return {
    id,
    name,
    description: description || null,
    createdAt: now,
    updatedAt: now,
    // 默认关闭：只有用户在设置里显式开启才会触发图谱构建
    enableGraphIndexing: false,
    // 若未传入则使用空数组，方便前端直接遍历
    tags: tags ?? [],
    ...(embeddingModelId ? { embeddingModelId } : {})
  };
}
