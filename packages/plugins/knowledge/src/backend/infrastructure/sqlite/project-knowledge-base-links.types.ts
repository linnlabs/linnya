/**
 * @file project-knowledge-base-links.types.ts
 * @description 项目-知识库关联相关的类型定义
 * 
 * 这些类型可以在前端和后端共享使用
 */

/**
 * 项目-知识库链接记录
 */
export interface ProjectKnowledgeBaseLink {
  projectId: string;
  kbId: string;
  role: 'read_only' | 'read_write';
  createdAt: number;
  updatedAt: number;
}

/**
 * 项目信息（简化版本，用于列表展示）
 */
export interface ProjectInfo {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

/**
 * 知识库基本信息（用于列表展示）
 */
export interface KnowledgeBaseInfo {
  id: string;
  name: string;
  description?: string;
  embeddingModelId?: string;
  rerankModelId?: string;
  visionModelId?: string;
  createdAt: number;
  updatedAt?: number;
}

/**
 * 项目-知识库关联角色类型
 */
export type ProjectKbLinkRole = 'read_only' | 'read_write';
