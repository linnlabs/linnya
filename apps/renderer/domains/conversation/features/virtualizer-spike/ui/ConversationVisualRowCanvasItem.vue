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
import type { ConversationMessageVisualRow } from '../../../ui/messageCanvas';
import { resolveTerminalFinalAnswer } from '../../../functions/resolveTerminalFinalAnswer';
import type {
  EditUserMessageCommand,
  RegenerateUserMessageCommand,
} from '../../../definitions/userMessageContent';

const props = defineProps<{
  row: ConversationMessageVisualRow;
  messages: readonly BaseMessage[];
}>();

defineEmits<{
  'copy-turn': [row: ConversationMessageVisualRow];
  'save-turn': [row: ConversationMessageVisualRow];
  'edit-message': [command: EditUserMessageCommand];
  'regenerate-response': [command: RegenerateUserMessageCommand];
}>();

const sourceMessageIdSet = computed(() => new Set(props.row.turnContext.sourceMessageIds));
const sourceMessages = computed(() => props.messages.filter(message => sourceMessageIdSet.value.has(message.id)));
const terminalFinalAnswer = computed(() => resolveTerminalFinalAnswer(sourceMessages.value));
const isTerminalAnswerRow = computed(() => terminalFinalAnswer.value?.id === props.row.payload.id);
const rowClasses = computed(() => ({
  'is-turn-start': props.row.isTurnStart,
  'is-turn-end': props.row.isTurnEnd,
  'is-bounded': props.row.bounded,
}));
</script>
