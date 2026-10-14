import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import type { BaseMessage } from '../../../types';
import { refreshCurrentWindow } from '../../../message-window/orchestration/messageWindowLoader';
import { useClientNoticeStore } from '../store/clientNoticeStore';
import { localClientNoticeMessages } from '../functions/clientNoticePresentation';
import { currentClientNoticeDraftKey, getConversationClientNotices, synchronizeConversationClientNotices } from './conversationClientNotices';
import { synchronizeClientNoticeHistory } from './synchronizeClientNoticeHistory';

export function useClientNoticePresentation(deps: {
  readonly conversationId: () => string | null;
  readonly messages: () => readonly BaseMessage[];
  readonly isActive: () => boolean;
}) {
  const store = useClientNoticeStore();
  getConversationClientNotices();
  const localNotices = computed(() => localClientNoticeMessages(
    store.entries, deps.conversationId(), currentClientNoticeDraftKey(), deps.messages(),
  ));
  async function synchronizeVisible(): Promise<void> {
    const conversationId = deps.conversationId();
    if (!deps.isActive() || !conversationId || !store.entries.some(entry => entry.conversationId === conversationId)) return;
    await synchronizeClientNoticeHistory({
      synchronize: () => synchronizeConversationClientNotices(conversationId),
      isCurrent: () => deps.conversationId() === conversationId,
      refresh: () => refreshCurrentWindow(conversationId, { readLiveMessages: deps.messages }),
    });
  }
  watch(deps.conversationId, synchronizeVisible);
  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    void synchronizeVisible();
    window.addEventListener('online', synchronizeVisible);
    // 仅补送未确认产品事实；不发送用户消息，不恢复 Agent，不拥有模型重试策略。
    timer = setInterval(synchronizeVisible, 15_000);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('online', synchronizeVisible);
    if (timer) clearInterval(timer);
  });
  return { localNotices };
}
