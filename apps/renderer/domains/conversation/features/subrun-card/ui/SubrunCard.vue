<template>
  <UiCardGroup
    :header="presentation.header"
    :children="presentation.children"
    :is-streaming="isRunning"
    :is-active="isRunning"
    :has-next="props.hasNext"
    :max-visible-children="80"
    :bounded="true"
    :expansion-state="props.expansionState"
    @expanded="handleExpanded"
    @expanded-change="emit('expanded-change', $event)"
  >
    <template #empty>
      <div v-if="bodyState === 'error'" class="subrun-card__body-state">
        <button class="subrun-card__retry" type="button" @click.stop="handleExpanded">
          {{ conversationMessage('conversation.tool.subrunTrace.retry') }}
        </button>
      </div>
    </template>
  </UiCardGroup>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ConversationMessageId } from '@app/schemas';

import UiCardGroup from '../../../ui/components/UiCardGroup.vue';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type { SubrunCardPresentation } from '../definitions/subrunCard';
import type { HistoricalSubrunTraceLazySource } from '../../subrun-trace';
import { buildSubrunCardPresentation } from '../functions/buildSubrunCardPresentation';
import { resolveSubrunCardBodyState } from '../functions/resolveSubrunCardBodyState';
import { useSubrunCardTrace } from '../orchestration/useSubrunCardTrace';

const props = withDefaults(defineProps<{
  readonly messageId: ConversationMessageId;
  readonly presentation: SubrunCardPresentation;
  readonly subrunTrace?: unknown;
  readonly subrunTraceVersion?: number;
  readonly subrunId?: string;
  readonly lazySubrunTraceSource?: HistoricalSubrunTraceLazySource;
  readonly hasNext?: boolean;
  readonly expansionState?: 'expanded' | 'collapsed';
}>(), {
  lazySubrunTraceSource: undefined,
  hasNext: false,
  expansionState: undefined,
});
const emit = defineEmits<{
  'expanded-change': [expanded: boolean];
}>();
const { conversationMessage } = useConversationLocalization();
const isRunning = computed(() => props.presentation.data.status === 'loading');
const trace = useSubrunCardTrace({
  subrunTrace: () => props.subrunTrace,
  subrunTraceVersion: () => props.subrunTraceVersion,
  subrunId: () => props.subrunId ?? props.presentation.data.subrunId,
  lazySource: () => props.lazySubrunTraceSource,
});
const presentation = computed(() => buildSubrunCardPresentation({
  history: trace.messages.value,
  headerMessageId: props.messageId,
  description: props.presentation.data.description,
  conversationMessage,
}));
const bodyState = computed(() => resolveSubrunCardBodyState({
  childCount: presentation.value.children.length,
  lazyStatus: trace.lazyStatus.value,
  hasProjectionError: trace.projectionError.value !== null,
}));
async function handleExpanded(): Promise<void> {
  await trace.loadWhenExpanded();
}
</script>
