import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import type { MessageWindowStatus } from '../../../message-window';
import type { BaseMessage } from '../../../types';
import type { TimelineMarker } from '../definitions/timelineMarker';
import type {
  TimelineTurnIndexApiPort,
  TimelineTurnIndexLoadStatus,
} from '../definitions/timelineTurnIndex';
import {
  mergeTimelineMarkersWithVisibleMessages,
  projectTimelineMarkersFromMessages,
  projectTimelineMarkersFromTurnIndex,
} from '../functions/timelineMarkers';
import { timelineTurnIndexApi } from './timelineTurnIndexApi';

const PREPARING_RETRY_MS = 500;

interface UseTimelineTurnIndexParams {
  readonly conversationId: Ref<string | null>;
  readonly messages: Ref<readonly BaseMessage[]>;
  readonly isStreaming: Ref<boolean>;
  readonly windowConversationId: Ref<string | null>;
  readonly windowStatus: Ref<MessageWindowStatus>;
  readonly windowRevision: Ref<number | null>;
}

interface UseTimelineTurnIndexDeps {
  readonly api?: TimelineTurnIndexApiPort;
}

export function useTimelineTurnIndex(
  params: UseTimelineTurnIndexParams,
  deps: UseTimelineTurnIndexDeps = {},
) {
  const api = deps.api ?? timelineTurnIndexApi;
  const indexedMarkers = shallowRef<TimelineMarker[] | null>(null);
  const indexedConversationId = ref<string | null>(null);
  const indexedRevision = ref<number | null>(null);
  const status = ref<TimelineTurnIndexLoadStatus>('idle');
  const visibleUserMessages = shallowRef<BaseMessage[]>([]);
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let requestToken = 0;

  const visibleUserSignature = computed(() => JSON.stringify(
    params.messages.value
      .filter(message => message.type === 'user_input')
      .map(message => [message.id, message.content]),
  ));
  const fallbackMarkers = computed(() => projectTimelineMarkersFromMessages(visibleUserMessages.value));
  const markers = computed<readonly TimelineMarker[]>(() => {
    if (status.value === 'error') return [];
    if (
      indexedMarkers.value === null
      || indexedConversationId.value !== params.conversationId.value
    ) {
      return fallbackMarkers.value;
    }
    return mergeTimelineMarkersWithVisibleMessages(indexedMarkers.value, visibleUserMessages.value);
  });

  watch(
    visibleUserSignature,
    () => {
      visibleUserMessages.value = params.messages.value.filter(message => message.type === 'user_input');
    },
    { immediate: true },
  );

  const clearRetry = (): void => {
    if (retryTimer === null) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  };

  const canReadTurnIndex = (conversationId: string): boolean => (
    params.windowConversationId.value === conversationId
    && params.windowStatus.value === 'ready'
  );

  const scheduleRetry = (conversationId: string): void => {
    clearRetry();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (params.conversationId.value === conversationId && canReadTurnIndex(conversationId)) {
        void refresh(conversationId);
      }
    }, PREPARING_RETRY_MS);
  };

  const refresh = async (conversationId: string): Promise<void> => {
    const token = ++requestToken;
    status.value = 'loading';
    try {
      const dto = await api.readTurnIndex(conversationId);
      if (token !== requestToken || params.conversationId.value !== conversationId) return;
      if (dto.success === false) {
        status.value = 'preparing';
        scheduleRetry(conversationId);
        return;
      }
      clearRetry();
      indexedConversationId.value = conversationId;
      indexedRevision.value = dto.revision;
      indexedMarkers.value = projectTimelineMarkersFromTurnIndex(dto.turns);
      status.value = 'ready';
    } catch (error) {
      if (token !== requestToken || params.conversationId.value !== conversationId) return;
      status.value = 'error';
      console.error('[TimelineTurnIndex] Failed to load turn index:', error);
    }
  };

  watch(
    () => params.conversationId.value,
    (conversationId) => {
      requestToken += 1;
      clearRetry();
      indexedMarkers.value = null;
      indexedConversationId.value = null;
      indexedRevision.value = null;
      status.value = 'idle';
      if (conversationId && canReadTurnIndex(conversationId)) {
        void refresh(conversationId);
      }
    },
    { immediate: true },
  );

  watch(
    () => [
      params.windowConversationId.value,
      params.windowStatus.value,
      params.windowRevision.value,
    ] as const,
    ([windowConversationId, windowStatus, windowRevision]) => {
      const conversationId = params.conversationId.value;
      if (!conversationId || windowConversationId !== conversationId || windowStatus !== 'ready') return;
      if (
        indexedConversationId.value !== conversationId
        || indexedRevision.value !== windowRevision
      ) {
        void refresh(conversationId);
      }
    },
  );

  watch(
    () => params.isStreaming.value,
    (isStreaming, wasStreaming) => {
      const conversationId = params.conversationId.value;
      if (wasStreaming && !isStreaming && conversationId && canReadTurnIndex(conversationId)) {
        void refresh(conversationId);
      }
    },
  );

  onScopeDispose(() => {
    requestToken += 1;
    clearRetry();
  });

  return { markers, status, refresh };
}
