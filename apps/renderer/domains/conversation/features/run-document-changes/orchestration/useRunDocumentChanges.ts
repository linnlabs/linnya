import { computed, onBeforeUnmount, watch, type ComputedRef, type Ref } from 'vue';
import { useNotificationStore } from '@/app/notification';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type {
  RunDocumentChangeItem,
  RunDocumentChangeList,
  RunDocumentChangeOpenIntent,
} from '../definitions/runDocumentChanges';
import { findRunDocumentChangesPort } from '../registry/runDocumentChangesPort';
import {
  getRunDocumentChangesCacheEntry,
  runDocumentChangesCacheKey,
  type RunDocumentChangesCacheEntry,
} from '../store/runDocumentChangesCache';

const REFRESH_DEBOUNCE_MS = 150;

export interface RunDocumentChangesState {
  readonly list: ComputedRef<RunDocumentChangeList | null>;
  readonly expanded: ComputedRef<boolean>;
  readonly showAll: ComputedRef<boolean>;
  setExpanded(value: boolean): void;
  showAllItems(): void;
  open(item: RunDocumentChangeItem, intent: RunDocumentChangeOpenIntent): Promise<void>;
}

/**
 * 一轮回复结束后读这些运行改过的文档。只在 `enabled` 时读取：运行中由工具卡逐条显示，
 * 不提前出清单。文档改名、删除或修订被处理时重读，让待审阅数保持当前事实。
 */
export function useRunDocumentChanges(input: {
  readonly conversationId: string | null;
  readonly rootRunIds: Ref<readonly string[]>;
  readonly enabled: Ref<boolean>;
}): RunDocumentChangesState {
  const port = findRunDocumentChangesPort();
  const entry = computed<RunDocumentChangesCacheEntry | null>(() => {
    if (!port || !input.conversationId || input.rootRunIds.value.length === 0) return null;
    return getRunDocumentChangesCacheEntry(runDocumentChangesCacheKey(input.conversationId, input.rootRunIds.value));
  });
  let disposed = false;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let stopWatching: (() => void) | null = null;

  function refresh(target: RunDocumentChangesCacheEntry): void {
    if (!port || !input.conversationId) return;
    const generation = ++target.generation;
    void port.list({ conversationId: input.conversationId, rootRunIds: input.rootRunIds.value })
      .then((list) => {
        if (generation === target.generation) target.list.value = list;
      })
      .catch((error: unknown) => {
        console.warn('[RunDocumentChanges] 读取本轮改动的文档失败', { error });
      });
  }

  function scheduleRefresh(): void {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const target = entry.value;
      if (!disposed && target && input.enabled.value) refresh(target);
    }, REFRESH_DEBOUNCE_MS);
  }

  watch([entry, input.enabled], ([target, enabled]) => {
    if (target && enabled) refresh(target);
  }, { immediate: true });

  const documentIds = computed(() => {
    const items = input.enabled.value ? entry.value?.list.value?.items ?? [] : [];
    return items.map(item => item.documentId).sort().join('\n');
  });
  watch(documentIds, (ids) => {
    stopWatching?.();
    stopWatching = null;
    if (!port || ids.length === 0) return;
    stopWatching = port.watch(new Set(ids.split('\n')), scheduleRefresh);
  }, { immediate: true });

  onBeforeUnmount(() => {
    disposed = true;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    stopWatching?.();
  });

  return {
    list: computed(() => (input.enabled.value ? entry.value?.list.value ?? null : null)),
    expanded: computed(() => entry.value?.expanded.value ?? false),
    showAll: computed(() => entry.value?.showAll.value ?? false),
    setExpanded(value) {
      if (entry.value) entry.value.expanded.value = value;
    },
    showAllItems() {
      if (entry.value) entry.value.showAll.value = true;
    },
    async open(item, intent) {
      if (!port) return;
      try {
        await port.open(item, intent);
      } catch (error: unknown) {
        console.warn('[RunDocumentChanges] 打开改动的文档失败', { documentId: item.documentId, intent, error });
        // 只在失败时取通知与文案（都依赖 Pinia）：没装配 Pinia 的画布（夹具、单测）也能渲染尾部。
        const { conversationMessage } = useConversationLocalization();
        useNotificationStore().show(conversationMessage('conversation.runChanges.openFailed'), 'error', 3000);
      }
    },
  };
}
