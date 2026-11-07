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
      <div class="conversation-visual-row__tail-line">
        <ConversationWorkDurationHint
          v-if="!runChangesNote"
          :duration-ms="turnDurationMs"
          :is-streaming="isTurnStreaming"
        />
        <RunDocumentChangesNote
          v-if="runChangesNote"
          :note="runChangesNote"
          :expanded="runChanges.expanded.value"
          @toggle="runChanges.setExpanded(!runChanges.expanded.value)"
          @open="runChanges.open"
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
          <LinnyaLoadingIcon activity="thinking" />
        </div>
      </div>
      <RunDocumentChangesList
        v-if="runChangesNote && !runChangesNote.single && runChanges.expanded.value"
        :items="runChangesNote.items"
        :show-all="runChanges.showAll.value"
        :truncated="runChanges.list.value?.truncated ?? false"
        @open="runChanges.open"
        @show-all="runChanges.showAllItems()"
      />
      <!-- 有改动清单时，已工作时长放在清单最下面。 -->
      <ConversationWorkDurationHint
        v-if="runChangesNote"
        class="conversation-visual-row__tail-duration"
        :duration-ms="turnDurationMs"
        :is-streaming="isTurnStreaming"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, type CSSProperties } from 'vue';
import type { BaseMessage } from '../../../types';
import type {
  EditUserMessageCommand,
  RegenerateUserMessageCommand,
} from '../../../definitions/userMessageContent';
import { resolveTurnFinalAnswers } from '../../../functions/resolveTerminalFinalAnswer';
import { isRecord } from '../../../utils/typeGuards';
import {
  collectVisualTurnRunIds,
  isAnswerSegmentStreaming,
  isVisualTurnOwnedByActiveRun,
} from '../functions/conversationRunRendering';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../definitions/conversationRenderScope';
import {
  projectRunDocumentChangesNote,
  RunDocumentChangesList,
  RunDocumentChangesNote,
  useRunDocumentChanges,
} from '../../../features/run-document-changes';
import type { ConversationVisualRow as ConversationVisualRowModel } from '../definitions/conversationVisualRow';
import type {
  ConversationMessageCanvasTrailingStatus,
  ConversationVisualRowMeasureElement,
} from '../definitions/conversationMessageCanvas';
import { resolveConversationRowTailLayout } from '../functions/resolveConversationRowTailLayout';
import Message from '../../Message.vue';
import ConversationWorkDurationHint from '../../components/ConversationWorkDurationHint.vue';
import ConversationVisualRowActions from './ConversationVisualRowActions.vue';
import { LinnyaLoadingIcon } from '@linnya/renderer-ui/icons';

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
  /** 只有主时间线列出本轮改动的文档；Subrun 详情不列。 */
  showsRunDocumentChanges?: boolean;
}>(), {
  previousRow: undefined,
  offsetPx: undefined,
  measureElement: undefined,
  activeRunIds: () => [],
  actionsVisible: false,
  isLastRow: false,
  trailingStatus: () => ({ active: false, visible: false }),
  showsRunDocumentChanges: false,
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

const renderScope = inject(CONVERSATION_RENDER_SCOPE_KEY, null);
const turnRunIds = computed(() => collectVisualTurnRunIds(props.turnMessages));
// 运行中由工具卡逐条显示；本轮结束后才读改动清单。
const runChanges = useRunDocumentChanges({
  conversationId: renderScope?.conversationId ?? null,
  rootRunIds: turnRunIds,
  enabled: computed(() => (
    props.showsRunDocumentChanges
    && props.item.isTurnEnd
    && !isTurnStreaming.value
  )),
});
const runChangesNote = computed(() => projectRunDocumentChangesNote(runChanges.list.value?.items ?? []));
const tailLayout = computed(() => resolveConversationRowTailLayout({
  isTurnEnd: props.item.isTurnEnd,
  isLastRow: props.isLastRow,
  hasAnswerActions: actionAnswers.value.length > 0,
  trailingStatusActive: props.trailingStatus.active,
  hasRunDocumentChanges: runChangesNote.value !== null,
}));
const turnDurationMs = computed(() => {
  const userMessage = props.turnMessages.find(
    message => message.id === props.item.turnContext.userMessageId,
  );
  const agentWork = userMessage?.type === 'user_input' ? userMessage.metadata?.agent_work : undefined;
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
