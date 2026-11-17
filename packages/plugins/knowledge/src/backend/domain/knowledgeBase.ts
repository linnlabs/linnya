/**
 * @file src/knowledge-base/domain/knowledgeBase.ts
 *
 * @brief 知识库实体和相关类型定义
 *
 * @description
 * 该文件定义了知识库的核心领域模型，包括知识库实体的数据结构和类型。
 * 知识库是文档的容器，具有自己的元数据和配置信息。
 */

import type { KnowledgeBase } from '@plugin/knowledge/shared';
export { KnowledgeBaseSchema, type KnowledgeBase } from '@plugin/knowledge/shared';

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
  updatedAt: new Date().toISOString(),
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
    ...(embeddingModelId ? { embeddingModelId } : {}),
  };
}
