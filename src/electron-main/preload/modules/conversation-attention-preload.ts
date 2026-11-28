import type { IpcRenderer } from 'electron';
import { CONVERSATION_ATTENTION_NOTIFY_CHANNEL, type ConversationAttentionNotification } from '@app/schemas/conversation-attention';

export function buildConversationAttentionPreloadApi(ipc: IpcRenderer) {
  return {
    /** `open` 为 true 是用户点了系统通知，要打开对话；false 是窗口在前台时的应用内提示。 */
    onNotify(listener: (notification: ConversationAttentionNotification, open: boolean) => void): () => void {
      const receive = (_event: unknown, notification: ConversationAttentionNotification, open?: boolean) => listener(notification, open === true);
      ipc.on(CONVERSATION_ATTENTION_NOTIFY_CHANNEL, receive);
      return () => { ipc.removeListener(CONVERSATION_ATTENTION_NOTIFY_CHANNEL, receive); };
    },
  };
}
