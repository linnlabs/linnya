<template>
  <section
    :ref="measureElement"
    class="conversation-visual-row"
    :class="rowClasses"
    :data-index="index"
    :data-visual-turn-start-id="item.isTurnStart ? item.visualTurnId : undefined"
    :data-visual-turn-id="item.visualTurnId"
    :style="rowStyle"
    @mouseenter="$emit('row-mouseenter', item)"
    @mouseleave="$emit('row-mouseleave', item, $event)"
  >
    <div class="conversation-visual-row__content">
      <div class="conversation-visual-row__content-inner">
        <Message
          :message="item.payload"
          :is-streaming="isMessageStreaming"
          @edit-message="$emit('edit-message', $event)"
          @regenerate-response="$emit('regenerate-response', $event)"
        />
      </div>
    </div>

    <div v-if="tailLayout.ownsTailRegion" class="conversation-visual-row__tail">
      <ConversationWorkDurationHint
        :duration-ms="turnDurationMs"
        :is-streaming="isTurnStreaming"
      />
      <ConversationVisualRowActions
        :answers="actionAnswers"
        :is-streaming="isTurnStreaming"
        variant="turn"
      />
      <div
        v-if="tailLayout.ownsTrailingStatus"
        class="conversation-visual-row__waiting-indicator"
        :class="{ 'is-visible': trailingStatus.visible }"
        aria-hidden="true"
      >
        <RippleLoadingIcon />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from 'vue';
import type { BaseMessage } from '../../../types';
import type {
  EditUserMessageCommand,
  RegenerateUserMessageCommand,
} from '../../../definitions/userMessageContent';
import { resolveTurnFinalAnswers } from '../../../functions/resolveTerminalFinalAnswer';
import { isRecord } from '../../../utils/typeGuards';
import {
  isAnswerSegmentStreaming,
  isVisualTurnOwnedByActiveRun,
} from '../functions/conversationRunRendering';
import type { ConversationVisualRow as ConversationVisualRowModel } from '../definitions/conversationVisualRow';
import type {
  ConversationMessageCanvasTrailingStatus,
  ConversationVisualRowMeasureElement,
} from '../definitions/conversationMessageCanvas';
import { resolveConversationRowTailLayout } from '../functions/resolveConversationRowTailLayout';
import Message from '../../Message.vue';
import ConversationWorkDurationHint from '../../components/ConversationWorkDurationHint.vue';
import ConversationVisualRowActions from './ConversationVisualRowActions.vue';
import { RippleLoadingIcon } from '@linnya/renderer-ui/icons';

const props = withDefaults(defineProps<{
  item: ConversationVisualRowModel;
  previousRow?: ConversationVisualRowModel;
  turnMessages: readonly BaseMessage[];
  index: number;
  offsetPx?: number;
  measureElement?: ConversationVisualRowMeasureElement;
  activeRunIds?: readonly string[];
  actionsVisible?: boolean;
  isLastRow?: boolean;
  trailingStatus?: ConversationMessageCanvasTrailingStatus;
}>(), {
  previousRow: undefined,
  offsetPx: undefined,
  measureElement: undefined,
  activeRunIds: () => [],
  actionsVisible: false,
  isLastRow: false,
  trailingStatus: () => ({ active: false, visible: false }),
});

defineEmits<{
  'row-mouseenter': [row: ConversationVisualRowModel];
  'row-mouseleave': [row: ConversationVisualRowModel, event: globalThis.MouseEvent];
  'edit-message': [command: EditUserMessageCommand];
  'regenerate-response': [command: RegenerateUserMessageCommand];
}>();

const isTurnStreaming = computed(() => (
  isVisualTurnOwnedByActiveRun(props.turnMessages, props.activeRunIds)
));
const isMessageStreaming = computed(() => (
  isAnswerSegmentStreaming(props.item.payload, isTurnStreaming.value)
));
const actionAnswers = computed(() => resolveTurnFinalAnswers(props.turnMessages));
const tailLayout = computed(() => resolveConversationRowTailLayout({
  isTurnEnd: props.item.isTurnEnd,
  isLastRow: props.isLastRow,
  hasAnswerActions: actionAnswers.value.length > 0,
  trailingStatusActive: props.trailingStatus.active,
}));
const turnDurationMs = computed(() => {
  const userMessage = props.turnMessages.find(
    message => message.id === props.item.turnContext.userMessageId,
  );
  const agentWork = userMessage?.metadata?.['agent_work'];
  if (!isRecord(agentWork)) return undefined;
  const duration = agentWork['duration_ms'];
  return typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
    ? duration
    : undefined;
});
const rowClasses = computed(() => ({
  'virtual-conversation-item': props.offsetPx !== undefined,
  'virtual-conversation-canvas-item': props.offsetPx !== undefined,
  'is-turn-start': props.item.isTurnStart,
  'is-turn-end': props.item.isTurnEnd,
  'is-bounded': props.item.bounded,
  'is-actions-visible': props.actionsVisible,
  'follows-user-message': props.previousRow?.payload.type === 'user_input',
  'follows-user-thought': props.previousRow?.payload.type === 'user_input'
    && props.item.payload.type === 'thought',
}));
const rowStyle = computed<CSSProperties | undefined>(() => (
  props.offsetPx === undefined
    ? undefined
    : {
        position: 'absolute',
        top: '0',
        left: '0',
        transform: `translateY(${props.offsetPx}px)`,
      }
));
</script>
