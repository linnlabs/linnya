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
 * 项目-知识库关联 IPC 响应类型
 */
export interface ProjectKbLinkResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  count?: number;
  deleted?: boolean;
}

/**
 * 项目-知识库关联角色类型
 */
export type ProjectKbLinkRole = 'read_only' | 'read_write';

/**
 * 项目-知识库关联 IPC 通道名称
 */
export const PROJECT_KB_LINK_IPC_CHANNELS = {
  LINK: 'project-kb-links:link',
  UNLINK: 'project-kb-links:unlink',
  LIST_KB_IDS: 'project-kb-links:list-kb-ids',
  LIST_KB_DETAILS: 'project-kb-links:list-kb-details',
  LIST_PROJECT_IDS: 'project-kb-links:list-project-ids',
  LIST_PROJECT_DETAILS: 'project-kb-links:list-project-details',
  GET_LINK_DETAIL: 'project-kb-links:get-link-detail',
  LINK_MULTIPLE: 'project-kb-links:link-multiple',
  IS_LINKED: 'project-kb-links:is-linked',
  CLEAR_PROJECT: 'project-kb-links:clear-project',
  CLEAR_KB: 'project-kb-links:clear-kb',
} as const;

