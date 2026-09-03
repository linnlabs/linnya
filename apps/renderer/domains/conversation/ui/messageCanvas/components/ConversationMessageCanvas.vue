<template>
  <div
    class="conversation-message-canvas"
    :class="{ 'conversation-message-canvas--virtual': heightPx !== undefined }"
    :style="canvasStyle"
  >
    <ConversationVisualRow
      v-for="placement in effectivePlacements"
      :key="placement.item.key"
      :item="placement.item"
      :previous-row="items[placement.index - 1]"
      :turn-messages="messagesByVisualTurnId.get(placement.item.visualTurnId) ?? []"
      :index="placement.index"
      :offset-px="placement.offsetPx"
      :measure-element="measureElement"
      :active-run-ids="activeRunIds"
      :actions-visible="hoveredVisualTurnId === placement.item.visualTurnId"
      :is-last-row="placement.index === items.length - 1"
      :trailing-status="trailingStatus"
      @row-mouseenter="hoveredVisualTurnId = $event.visualTurnId"
      @row-mouseleave="handleRowMouseLeave"
      @edit-message="$emit('edit-message', $event)"
      @regenerate-response="$emit('regenerate-response', $event)"
    />
    <ConversationAnswerRenderHost
      ref="answerRenderHostRef"
      :answers="activeTransferAnswers"
      :width-px="answerRenderWidthPx"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, provide, ref, type CSSProperties } from 'vue';
import type { ConversationVisualTurnId } from '@app/schemas';
import type { BaseMessage } from '../../../types';
import type {
  EditUserMessageCommand,
  RegenerateUserMessageCommand,
} from '../../../definitions/userMessageContent';
import type { ConversationVisualRow as ConversationVisualRowModel } from '../definitions/conversationVisualRow';
import type {
  ConversationMessageCanvasRowPlacement,
  ConversationMessageCanvasTrailingStatus,
  ConversationVisualRowMeasureElement,
} from '../definitions/conversationMessageCanvas';
import { indexConversationVisualTurnMessages } from '../functions/indexConversationVisualTurnMessages';
import {
  ConversationAnswerRenderHost,
  RENDERED_ANSWER_TRANSFER_PORT_KEY,
  useRenderedAnswerTransferHost,
} from '../../tools/knowledge/clipboard';
import ConversationVisualRow from './ConversationVisualRow.vue';

const props = withDefaults(defineProps<{
  items: readonly ConversationVisualRowModel[];
  messages: readonly BaseMessage[];
  placements?: readonly ConversationMessageCanvasRowPlacement[];
  heightPx?: number;
  measureElement?: ConversationVisualRowMeasureElement;
  activeRunIds?: readonly string[];
  answerRenderWidthPx?: number;
  trailingStatus?: ConversationMessageCanvasTrailingStatus;
}>(), {
  placements: undefined,
  heightPx: undefined,
  measureElement: undefined,
  activeRunIds: () => [],
  answerRenderWidthPx: 720,
  trailingStatus: () => ({ active: false, visible: false }),
});

defineEmits<{
  'edit-message': [command: EditUserMessageCommand];
  'regenerate-response': [command: RegenerateUserMessageCommand];
}>();

const hoveredVisualTurnId = ref<ConversationVisualTurnId | null>(null);
const {
  activeAnswers: activeTransferAnswers,
  hostRef: answerRenderHostRef,
  port: renderedAnswerTransferPort,
} = useRenderedAnswerTransferHost();
// 行操作属于消息画布能力。provider 必须与 visual-row 一起存续，不能绑在某个虚拟化宿主上。
provide(RENDERED_ANSWER_TRANSFER_PORT_KEY, renderedAnswerTransferPort);
const effectivePlacements = computed<readonly ConversationMessageCanvasRowPlacement[]>(() => (
  props.placements
  ?? props.items.map((item, index) => ({ item, index }))
));
const messagesByVisualTurnId = computed(() => indexConversationVisualTurnMessages(
  props.items,
  props.messages,
));
const canvasStyle = computed<CSSProperties | undefined>(() => (
  props.heightPx === undefined
    ? undefined
    : { position: 'relative', height: `${props.heightPx}px` }
));

function handleRowMouseLeave(row: ConversationVisualRowModel, event: globalThis.MouseEvent): void {
  const related = event.relatedTarget instanceof globalThis.Element
    ? event.relatedTarget.closest<globalThis.HTMLElement>('[data-visual-turn-id]')
    : null;
  if (related?.dataset.visualTurnId === row.visualTurnId) return;
  hoveredVisualTurnId.value = null;
}
</script>
