import { refreshCurrentWindow, readConversationLiveMessages, useMessageWindowStore } from '../../message-window';
import { useSubrunTraceInvalidationStore } from '../../features/subrun-trace';

/** 接纳变化的 durable revision 后才失效 lazy trace；相同 revision 不触发窗口或 trace 重读。 */
export async function refreshDetachedConversationView(
  conversationId: string,
  isObservationCurrent: () => boolean,
  transportGeneration: number,
) {
  const result = await refreshCurrentWindow(conversationId, {
    readLiveMessages: readConversationLiveMessages,
  }, isObservationCurrent);
  if (result === 'updated' || result === 'unchanged') {
    useMessageWindowStore().confirmDetachedRefresh(transportGeneration);
  }
  if (result === 'updated') {
    useSubrunTraceInvalidationStore().invalidateConversation(conversationId);
  }
  return result;
}
