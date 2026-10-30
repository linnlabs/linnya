import type { ConversationClientNoticeCommand } from '@app/schemas';
import { getRendererPersistStorage } from '@/shared/persistence/rendererPersistStorage';
import { useNavigationScope } from '@/app/navigation';
import { useClientNoticeStore } from '../store/clientNoticeStore';
import { createClientNoticeOutbox } from './clientNoticeOutbox';
import { sendClientNotice } from './clientNoticeApi';

const STORAGE_KEY = 'conversation-client-notices-v1';
const outboxes = new WeakMap<ReturnType<typeof useClientNoticeStore>, ReturnType<typeof createClientNoticeOutbox>>();
export function getConversationClientNotices() {
  const store = useClientNoticeStore();
  const existing = outboxes.get(store);
  if (existing) return existing;
  const storage = getRendererPersistStorage();
  const outbox = createClientNoticeOutbox({
    load: () => storage.getItem(STORAGE_KEY), save: text => storage.setItem(STORAGE_KEY, text),
    read: () => store.entries, replace: entries => store.replace(entries), send: sendClientNotice,
  });
  outbox.restore();
  outboxes.set(store, outbox);
  return outbox;
}

export function currentClientNoticeDraftKey(): string {
  const scope = useNavigationScope();
  // 草稿拥有正式的 workspace scope 和创建时刻；换项目或新建草稿不能吞并旧错误。
  return `${scope.currentScopeKey}:${scope.currentDraft?.createdAt ?? 'active'}`;
}

export function captureConversationClientNotice(
  conversationId: string | null,
  failure: Omit<ConversationClientNoticeCommand, 'notice_id' | 'observed_at'>,
): void {
  const outbox = getConversationClientNotices();
  outbox.capture({
    conversationId, draftKey: currentClientNoticeDraftKey(), acceptedAt: null,
    command: { ...failure, notice_id: crypto.randomUUID(), observed_at: Date.now() },
  });
  if (conversationId) void synchronizeConversationClientNotices(conversationId);
}

export async function synchronizeConversationClientNotices(conversationId: string): Promise<boolean> {
  try {
    await getConversationClientNotices().synchronize(conversationId);
    return true;
  } catch {
    // outbox 保留尚未同步的状态；不把网络错误再次记录成错误，避免无限增长。
    return false;
  }
}
