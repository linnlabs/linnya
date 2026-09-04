/**
 * @file apps/renderer/domains/editor/features/Review/types/reviewAnnotation.ts
 * @description Review（审阅）结果的前端数据模型（来自文档内批注）
 *
 * 数据来源：
 * - 持久化：`rootBlock.attrs.annotations`
 * - 读取：Annotation store 从当前 ProseMirror 文档派生（含 meta）
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

