import type { ConversationToolMessageMetadata } from '@app/schemas';

/**
 * durable 消息拆开保存 observation 与 data；这里只在 Renderer admission 边界重建工具结果。
 * 这样现有工具 owner 的 strict schema 不需要依赖存储布局。
 */
export function buildToolResultFromMessage(
  content: string,
  metadata: ConversationToolMessageMetadata,
): Record<string, unknown> | undefined {
  if (metadata.data === undefined) {
    return metadata.error === undefined
      ? undefined
      : { error: metadata.error, observation: content };
  }
  return {
    data: metadata.data,
    observation: content,
    ...(metadata.presentation ?? {}),
  };
}
