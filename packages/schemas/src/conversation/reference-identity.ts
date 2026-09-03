import { z } from 'zod';

/** Conversation composer 中一条引用实体的唯一身份。 */
export const ConversationReferenceIdSchema = z.string().regex(
  /^reference-[a-f0-9]{32}$/,
  'conversation reference id must use the reference UUID namespace',
);
export type ConversationReferenceId = z.infer<typeof ConversationReferenceIdSchema>;

/**
 * 引用身份由引用 feature 在创建实体时分配，后续 composer、请求、durable fact 与 UI 只透传。
 * 缺少 Web Crypto 属于运行环境装配错误，禁止退回时间戳或随机短串。
 */
export function generateConversationReferenceId(): ConversationReferenceId {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Conversation reference identity generation requires Web Crypto randomUUID.');
  }
  return `reference-${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
}
