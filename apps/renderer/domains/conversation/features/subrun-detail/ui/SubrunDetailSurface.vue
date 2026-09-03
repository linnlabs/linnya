<template>
  <section class="subrun-detail" :aria-label="scope.description">
    <div class="subrun-detail__content-column">
      <div v-if="!parentMessage" class="subrun-detail__state" role="alert">
        {{ conversationMessage('conversation.tool.subrunDetail.parentMissing') }}
      </div>
      <div v-else-if="trace.projectionError.value" class="subrun-detail__state" role="alert">
        <p>{{ conversationMessage('conversation.tool.subrunDetail.projectionFailed') }}</p>
      </div>
      <div
        v-else-if="trace.messages.value.length === 0 && trace.lazyStatus.value === 'error'"
        class="subrun-detail__state"
        role="alert"
      >
        <p>{{ conversationMessage('conversation.tool.subrunDetail.loadFailed') }}</p>
        <button type="button" @click="loadTrace">
          {{ conversationMessage('conversation.tool.subrunTrace.retry') }}
        </button>
      </div>
      <ConversationMessageCanvas
        v-else-if="detailMessages.length > 0"
        class="subrun-detail__message-canvas"
        :items="canvasVisualRows"
        :messages="detailMessages"
        :active-run-ids="activeSubrunRunIds"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, provide } from 'vue';

import { ConversationMessageCanvas } from '../../../ui/messageCanvas';
import { useAppendOnlyConversationVisualRows } from '../../../ui/conversationView/composables/useAppendOnlyConversationVisualRows';
import { cloneEstimationRegistry } from '../../../ui/conversationView/utils/estimationRegistry';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../definitions/conversationRenderScope';
import { MESSAGE_ENTRY_ANIMATION_PORT_KEY } from '../../../definitions/messageEntryAnimation';
import { useSubrunCardTrace } from '../../subrun-card';
import { SUBRUN_TRACE_SUBRUN_CARD_KINDS } from '../../subrun-trace';
import type { SubrunDetailScope } from '../definitions/subrunDetail';
import { resolveSubrunDetailParentMessage } from '../functions/resolveSubrunDetailParentMessage';
import { projectSubrunDetailMessages } from '../functions/projectSubrunDetailMessages';
import type { BaseMessage } from '../../../types';

const props = defineProps<{
  readonly scope: SubrunDetailScope;
  readonly messages: readonly BaseMessage[];
}>();
const { conversationMessage } = useConversationLocalization();
const parentMessage = computed(() => resolveSubrunDetailParentMessage({
  messages: props.messages,
  parentMessageId: props.scope.parentMessageId,
  parentToolCallId: props.scope.parentToolCallId,
}));

provide(CONVERSATION_RENDER_SCOPE_KEY, Object.freeze({ conversationId: props.scope.conversationId }));
provide(MESSAGE_ENTRY_ANIMATION_PORT_KEY, Object.freeze({
  isPending: () => false,
  consume: () => undefined,
}));

const trace = useSubrunCardTrace({
  subrunTrace: () => parentMessage.value?.metadata.subrunTrace,
  subrunTraceVersion: () => parentMessage.value?.metadata.subrunTraceVersion,
  subrunId: () => props.scope.subrunId,
  lazySource: () => ({
    conversationId: props.scope.conversationId,
    parentToolCallId: props.scope.parentToolCallId,
    subrunId: props.scope.subrunId,
    kinds: SUBRUN_TRACE_SUBRUN_CARD_KINDS,
  }),
});
const detailMessages = computed<readonly BaseMessage[]>(() => {
  const parent = parentMessage.value;
  if (!parent) return [];
  return projectSubrunDetailMessages({
    parentMessage: parent,
    subrunId: props.scope.subrunId,
    childMessages: trace.messages.value,
  });
});
provide('conversationMessages', () => detailMessages.value);

// Subrun 详情复用主会话的语义行投影和展示层，但不接管前台会话的虚拟化、滚动与分页状态。
// 静态画布不依赖估高宽度；稳定 registry 仍用于复用 append-only 投影，避免流式 chunk 全量重建。
const detailCanvasWidthPx = computed<number | undefined>(() => undefined);
const detailCanvasResetKey = computed(() => (
  `${props.scope.conversationId}:${props.scope.parentToolCallId}:${props.scope.subrunId}`
));
const { visualRows } = useAppendOnlyConversationVisualRows({
  messages: detailMessages,
  resetKey: detailCanvasResetKey,
  widthPx: detailCanvasWidthPx,
  estimationRegistry: cloneEstimationRegistry(),
});
// append-only builder 原地更新 rows 供主会话 virtualizer 消费；详情直接跨组件 prop，
// 因此在这个非虚拟化边界发布新快照，避免 Vue 因数组引用未变而跳过 Canvas 更新。
const canvasVisualRows = computed(() => [...visualRows.value]);
const activeSubrunRunIds = computed<readonly string[]>(() => (
  parentMessage.value?.metadata.status === 'loading' ? [props.scope.subrunId] : []
));

async function loadTrace(): Promise<void> {
  await trace.loadWhenExpanded();
}

onMounted(() => {
  void loadTrace();
});
</script>
