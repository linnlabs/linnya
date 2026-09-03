/**
 * @file apps/renderer/domains/editor/features/Review/types/reviewAnnotation.ts
 * @description Review（审阅）结果的前端数据模型（来自 annotations 表）
 *
 * 数据来源：
 * - IPC：`workspace:list-annotations`
 * - 后端会把 `annotations.content_json` JSON.parse 后展开到对象上（含 meta）
 */

export interface ReviewAnnotationMeta {
  source?: string;
  reviewRunId?: string;
  agentId?: string;
  chunkIndex?: number;
  [k: string]: unknown;
}

export interface ReviewAnnotation {
  id: string;
  blockId: string;
  content: string;
  author: string;
  state: string;
  createdAt: string;
  meta?: ReviewAnnotationMeta;
}


