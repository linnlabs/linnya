import { z } from 'zod';
import { ConversationAttentionNotificationSchema, type ConversationAttentionNotification } from '@app/schemas/conversation-attention';
import type { AppServerRpcHandlerRegistry, AppServerRpcPeer } from '../../app-server-rpc';

const NOTIFY_METHOD = 'desktop.conversation_attention.notify';
export type NotifyConversationAttention = (notification: ConversationAttentionNotification) => void | Promise<void>;

export function createConversationAttentionNotificationClient(rpc: Pick<AppServerRpcPeer, 'request'>) {
  return async (notification: ConversationAttentionNotification): Promise<void> => {
    const result = await rpc.request(NOTIFY_METHOD, ConversationAttentionNotificationSchema.parse(notification));
    z.null().parse(result);
  };
}

export function createConversationAttentionNotificationHandlers(notify: NotifyConversationAttention): AppServerRpcHandlerRegistry {
  return new Map([[NOTIFY_METHOD, async payload => {
    await notify(ConversationAttentionNotificationSchema.parse(payload));
    return null;
  }]]);
}
