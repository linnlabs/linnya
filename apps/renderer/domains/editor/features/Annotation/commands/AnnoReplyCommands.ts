/**
 * @file AnnoReplyCommands.ts
 * @description 批注“回复能力”的命令封装（当前仅提供 API 入口，不代表 UI 已正式开放回复功能）
 *
 * 设计目标：
 * - 最小改动：复用 useAnnotationStore.updateAnnotation 的持久化链路
 * - 低耦合：命令层只依赖 store 暴露的 addReply 方法
 * - 类型明确：避免 any，便于未来扩展为 AI 回复/多人协作回复
 */

export interface AnnotationReply {
  id: string;
  content: string;
  author: string;
  createdAt: string;
}

export interface AnnotationStoreWithReplyApi {
  addReply: (
    annotationId: string,
    replyInput: { content: string; author?: string; createdAt?: string; id?: string }
  ) => Promise<AnnotationReply | null>;
}

/**
 * 向指定批注追加一条回复（最小实现）。
 *
 * @param params.annotationId 批注 ID
 * @param params.content 回复内容
 * @param params.annotationStore 批注 store（必须实现 addReply）
 * @param params.author 可选：作者名（默认由 store 决定）
 */
export async function appendAnnotationReply(params: {
  annotationId: string;
  content: string;
  annotationStore: AnnotationStoreWithReplyApi;
  author?: string;
}): Promise<AnnotationReply | null> {
  const { annotationId, content, annotationStore, author } = params;

  if (!annotationId) {
    // 这里不做“防御性修复”，只做参数校验并让调用方感知失败
    throw new Error('[AnnoReplyCommands] appendAnnotationReply: 缺少 annotationId');
  }
  if (!content || !content.trim()) {
    throw new Error('[AnnoReplyCommands] appendAnnotationReply: content 为空');
  }

  return await annotationStore.addReply(annotationId, { content, author });
}


