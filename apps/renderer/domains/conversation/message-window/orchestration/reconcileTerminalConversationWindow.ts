import { useMessageWindowStore } from '../store/messageWindowStore';
import { loadTail } from './messageWindowLoader';
import { readConversationLiveMessages } from './readConversationLiveMessages';

/**
 * cancel 命令完成后，以 Host 已确认的 durable terminal tail 收尾当前可见窗口。
 *
 * message window 是单活跃窗口。若用户已经切到其它会话，旧会话不能抢占当前窗口；
 * 回切时 history loader 会走正常 tail 读取。仍在当前窗口时必须显式 reload，不能依赖
 * 已终止的 SSE 恰好送达最后一批 tool_output / run_status。
 */
export async function reconcileTerminalConversationWindow(
  conversationId: string,
): Promise<void> {
  const store = useMessageWindowStore();
  if (store.conversationId !== conversationId) return;
  await loadTail(conversationId, {}, {
    store,
    readLiveMessages: readConversationLiveMessages,
  });
}
