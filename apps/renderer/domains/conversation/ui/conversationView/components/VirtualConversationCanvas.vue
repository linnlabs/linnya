<template>
  <ConversationMessageCanvas
    class="virtual-conversation-list virtual-conversation-canvas"
    :items="items"
    :messages="messages"
    :placements="placements"
    :height-px="totalHeight"
    :measure-element="measureElement"
    :active-run-ids="activeRunIds"
    :answer-render-width-px="answerRenderWidthPx"
    :trailing-status="trailingStatus"
    @edit-message="$emit('edit-message', $event)"
    @regenerate-response="$emit('regenerate-response', $event)"
  />
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import type { BaseMessage } from '../../../types';
import type {
  EditUserMessageCommand,
  RegenerateUserMessageCommand,
} from '../../../definitions/userMessageContent';
import type {
  TanstackConversationTimelinePosition,
  TanstackConversationVisibleItem,
  useTanstackConversationVirtualizer,
} from '../composables/useTanstackConversationVirtualizer';
import {
  ConversationMessageCanvas,
  type ConversationMessageCanvasRowPlacement,
  type ConversationMessageCanvasTrailingStatus,
  type ConversationVisualRow,
} from '../../messageCanvas';

type MeasureElement = ReturnType<typeof useTanstackConversationVirtualizer>['measureElement'];

const props = withDefaults(defineProps<{
  items: ConversationVisualRow[];
  messages: BaseMessage[];
  virtualRows: TanstackConversationVisibleItem[];
  totalHeight: number;
  scrollMargin: number;
  timelinePositions: TanstackConversationTimelinePosition[];
  measureElement: MeasureElement;
  activeRunIds?: readonly string[];
  answerRenderWidthPx?: number;
  trailingStatus?: ConversationMessageCanvasTrailingStatus;
}>(), {
  activeRunIds: () => [],
  answerRenderWidthPx: 720,
  trailingStatus: () => ({ active: false, visible: false }),
});

const emit = defineEmits<{
  'layout-change': [positions: TanstackConversationTimelinePosition[]];
  'edit-message': [command: EditUserMessageCommand];
  'regenerate-response': [command: RegenerateUserMessageCommand];
}>();

const placements = computed<readonly ConversationMessageCanvasRowPlacement[]>(() => (
  props.virtualRows.map(entry => ({
    item: entry.item,
    index: entry.index,
    offsetPx: entry.virtualItem.start - props.scrollMargin,
  }))
));

watch(
  () => props.timelinePositions,
  positions => emit('layout-change', positions),
  { immediate: true, deep: false },
);

</script>
