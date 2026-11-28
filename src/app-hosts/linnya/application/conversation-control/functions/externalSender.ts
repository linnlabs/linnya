import type { ConversationExternalSender } from '@app/schemas';

/**
 * 经外部控制入口送达的消息都标出发件人，不显示成用户本人输入。
 * 名称是调用方自报的显示标签：这里只转交，任何准入或权限判断都不读它。
 */
export function externalSender(executorName: string | undefined): ConversationExternalSender {
  return { entry: 'linnya_cli', ...(executorName ? { name: executorName } : {}) };
}
