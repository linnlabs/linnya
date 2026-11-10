import { computed, ref, shallowRef, watch, type ComputedRef } from 'vue';
import { ConversationContextUsageSchema } from '@app/schemas';
import { apiFetch, getApiBaseUrl } from '@shared/services/aiService/common';
import type { BaseMessage } from '../../../types';
import type { ContextWindowUsagePresentation } from '../definitions/contextWindowUsage';
import { findLiveContextUsage, projectContextWindowUsage } from '../functions/projectContextWindowUsage';

interface ContextWindowUsageSources {
  readonly conversationId: ComputedRef<string | null>;
  readonly modelId: ComputedRef<string | null>;
  readonly agentId: ComputedRef<string | null>;
  readonly revision: ComputedRef<number | null>;
  readonly busy: ComputedRef<boolean>;
  readonly runId: ComputedRef<string | undefined>;
  readonly liveMessages: ComputedRef<readonly BaseMessage[]>;
}

export function useContextWindowUsagePresentation(sources: ContextWindowUsageSources) {
  const estimate = shallowRef<ContextWindowUsagePresentation>({ status: 'hidden' });
  const historyChanges = ref(0);
  watch(sources.revision, (revision, previous) => {
    // 首次接入窗口只补齐 revision，不代表对话内容又发生了一次变化。
    if (revision !== null && previous !== null) historyChanges.value++;
  });
  watch(
    [sources.conversationId, sources.modelId, sources.agentId, historyChanges, sources.busy],
    ([conversationId, modelId, agentId, changes, busy], previous, onCleanup) => {
      if (!conversationId || !modelId) {
        estimate.value = { status: 'hidden' };
        return;
      }
      const changedScope = conversationId !== previous[0] || modelId !== previous[1] || agentId !== previous[2];
      if (busy && !changedScope) return;
      if (changedScope || changes !== previous[3]) estimate.value = { status: 'loading' };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      onCleanup(() => {
        controller.abort();
        clearTimeout(timer);
      });

      async function refresh(id: string, model: string) {
        try {
          const baseUrl = await getApiBaseUrl();
          const params = new URLSearchParams({ model_id: model });
          const response = await apiFetch(
            `${baseUrl}/api/v1/conversation/${encodeURIComponent(id)}/context-usage?${params}`,
            { signal: controller.signal },
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const usage = ConversationContextUsageSchema.nullable().parse(await response.json());
          if (!controller.signal.aborted) {
            estimate.value = usage ? projectContextWindowUsage(usage) : { status: 'hidden' };
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          console.warn('[ContextWindowUsage] Cannot estimate conversation context', { conversationId: id, error });
          estimate.value = { status: 'unavailable' };
        }
        // 外部 CLI 运行没有本输入框的 SSE transport。只观察当前会话，服务端复用未变历史的估算。
        if (!controller.signal.aborted && !busy) {
          timer = setTimeout(() => void refresh(id, model), 4_000);
        }
      }
      void refresh(conversationId, modelId);
    },
    { immediate: true },
  );

  return computed<ContextWindowUsagePresentation>(() => {
    const modelId = sources.modelId.value;
    const runId = sources.runId.value;
    if (sources.busy.value && runId && modelId) {
      const usage = findLiveContextUsage(sources.liveMessages.value, runId, modelId);
      if (usage) return projectContextWindowUsage(usage);
    }
    return estimate.value;
  });
}
