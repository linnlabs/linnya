<template>
  <section
    class="visual-row-fixture-row"
    :class="rowClasses"
    :data-visual-turn-start-id="row.isTurnStart ? row.visualTurnId : undefined"
    :data-visual-row-key="row.key"
  >
    <div class="visual-row-fixture-row__content">
      <div class="visual-row-fixture-row__content-inner">
        <Message
          :message="row.payload"
          :is-streaming="false"
          @edit-message="$emit('edit-message', $event)"
          @regenerate-response="$emit('regenerate-response', $event)"
        />
      </div>
    </div>

    <ConversationWorkDurationHint
      v-if="row.isTurnEnd"
      :duration-ms="turnDurationMs"
      :is-streaming="false"
    />
    <ConversationAnswerActions
      v-if="isTerminalAnswerRow"
      variant="turn"
      copy-title="Copy rendered answer"
      save-title="Verify rendered export"
      copied-text="Copied"
      saved-status-text="Saved"
      :show-copied-text="false"
      :show-saved-text="false"
      :is-saving="false"
      @copy="$emit('copy-turn', row)"
      @save="$emit('save-turn', row)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BaseMessage } from '../../../types';
import Message from '../../../ui/Message.vue';
import ConversationAnswerActions from '../../../ui/components/ConversationAnswerActions.vue';
import ConversationWorkDurationHint from '../../../ui/components/ConversationWorkDurationHint.vue';
import type { ConversationVisualRow } from '../../../ui/messageCanvas';
import { resolveTerminalFinalAnswer } from '../../../functions/resolveTerminalFinalAnswer';
import type {
  EditUserMessageCommand,
  RegenerateUserMessageCommand,
} from '../../../definitions/userMessageContent';

const props = defineProps<{
  row: ConversationVisualRow;
  messages: readonly BaseMessage[];
}>();

defineEmits<{
  'copy-turn': [row: ConversationVisualRow];
  'save-turn': [row: ConversationVisualRow];
  'edit-message': [command: EditUserMessageCommand];
  'regenerate-response': [command: RegenerateUserMessageCommand];
}>();

const sourceMessageIdSet = computed(() => new Set(props.row.turnContext.sourceMessageIds));
const sourceMessages = computed(() => props.messages.filter(message => sourceMessageIdSet.value.has(message.id)));
const terminalFinalAnswer = computed(() => resolveTerminalFinalAnswer(sourceMessages.value));
const isTerminalAnswerRow = computed(() => terminalFinalAnswer.value?.id === props.row.payload.id);
const turnDurationMs = computed(() => {
  const userMessage = sourceMessages.value.find(message => message.id === props.row.turnContext.userMessageId);
  const agentWork = userMessage?.metadata?.['agent_work'];
  if (!agentWork || typeof agentWork !== 'object' || Array.isArray(agentWork)) return undefined;
  const duration = Reflect.get(agentWork, 'duration_ms');
  return typeof duration === 'number' && Number.isFinite(duration) ? duration : undefined;
});
const rowClasses = computed(() => ({
  'is-turn-start': props.row.isTurnStart,
  'is-turn-end': props.row.isTurnEnd,
  'is-bounded': props.row.bounded,
}));
</script>
