<template>
  <div class="subrun-progress-card">
    <SubrunTracePanel
      :status="presentation.data.status"
      :enabled="true"
      :subrun-trace="subrunTrace"
      :subrun-trace-version="subrunTraceVersion"
      :title-executing="showDescriptionInTrace ? presentation.data.description : undefined"
      :title-completed="showDescriptionInTrace ? presentation.data.description : undefined"
      :lazy-source="lazySource"
      :show-top-divider="false"
      disclosure-mode="static-expanded"
    >
      <template #actions>
        <button
          class="deep-trace__action"
          type="button"
          :disabled="!canonicalSubrunId"
          @click="openDetail"
        >
          {{ conversationMessage('conversation.tool.subrunDetail.open') }}
        </button>
      </template>
    </SubrunTracePanel>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import type { ConversationMessageId } from '@app/schemas';

import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../definitions/conversationRenderScope';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import { SUBRUN_DETAIL_NAVIGATION_PORT_KEY } from '../../subrun-detail';
import {
  SUBRUN_TRACE_STEP_KINDS,
  SubrunTracePanel,
  type HistoricalSubrunTraceLazySource,
} from '../../subrun-trace';
import type { SubrunCardPresentation } from '../definitions/subrunCard';
import {
  requireCanonicalSubrunId,
  requireSubrunProgressContext,
} from '../functions/requireSubrunProgressContext';
import { resolveSubrunCardTraceSource } from '../functions/resolveSubrunCardTraceSource';

const props = withDefaults(defineProps<{
  readonly messageId: ConversationMessageId;
  readonly parentToolCallId: string;
  readonly presentation: SubrunCardPresentation;
  readonly subrunTrace?: unknown;
  readonly subrunTraceVersion?: number;
  readonly subrunId?: string;
  readonly lazySubrunTraceSource?: HistoricalSubrunTraceLazySource;
  /** batch 外层只有总标题，每个内部过程仍需显示自己的任务描述。 */
  readonly showDescriptionInTrace?: boolean;
}>(), {
  showDescriptionInTrace: false,
});
const { navigation, renderScope } = requireSubrunProgressContext({
  navigation: inject(SUBRUN_DETAIL_NAVIGATION_PORT_KEY),
  renderScope: inject(CONVERSATION_RENDER_SCOPE_KEY),
});
const { conversationMessage } = useConversationLocalization();
const canonicalSubrunId = computed(() => props.subrunId ?? props.presentation.data.subrunId);
const lazySource = computed(() => resolveSubrunCardTraceSource({
  source: props.lazySubrunTraceSource,
  subrunId: canonicalSubrunId.value || undefined,
  kinds: SUBRUN_TRACE_STEP_KINDS,
}));

function openDetail(): void {
  const subrunId = requireCanonicalSubrunId(canonicalSubrunId.value);
  navigation.open({
    conversationId: renderScope.conversationId,
    parentMessageId: props.messageId,
    parentToolCallId: props.parentToolCallId,
    subrunId,
    description: props.presentation.data.description,
  });
}
</script>
