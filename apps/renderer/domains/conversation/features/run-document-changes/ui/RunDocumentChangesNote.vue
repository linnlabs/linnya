<template>
  <button
    type="button"
    class="run-document-changes-note"
    :class="{ 'is-static': singleDisabled }"
    :disabled="singleDisabled"
    :aria-expanded="note.single ? undefined : expanded"
    @click="handleClick"
  >
    <span class="run-document-changes-note__summary">{{ summaryText }}</span>
    <template v-if="stateText">
      <span
        class="run-document-changes-note__separator"
        aria-hidden="true"
      >·</span>
      <span
        class="run-document-changes-note__state"
        :class="{ 'is-pending': isPendingState }"
      >{{ stateText }}</span>
    </template>
    <ChevronIcon
      v-if="!note.single"
      class="run-document-changes-note__chevron"
      :direction="expanded ? 'up' : 'down'"
    />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type { RunDocumentChangeItem, RunDocumentChangeOpenIntent } from '../definitions/runDocumentChanges';
import {
  canOpenRunDocumentChange,
  resolveRunDocumentChangePrimaryIntent,
  type RunDocumentChangesNote,
} from '../functions/projectRunDocumentChangesNote';
import {
  resolveRunDocumentChangeDisplayTitle,
  resolveRunDocumentChangeStateKey,
} from '../functions/resolveRunDocumentChangeLabels';

const props = defineProps<{
  note: RunDocumentChangesNote;
  expanded: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  open: [item: RunDocumentChangeItem, intent: RunDocumentChangeOpenIntent];
}>();

const { conversationMessage } = useConversationLocalization();

const singleDisabled = computed(() => props.note.single !== null && !canOpenRunDocumentChange(props.note.single));
const summaryText = computed(() => (
  props.note.single
    ? conversationMessage('conversation.runChanges.summarySingle', {
      title: resolveRunDocumentChangeDisplayTitle(props.note.single),
    })
    : conversationMessage('conversation.runChanges.summary', { count: props.note.items.length })
));
const isPendingState = computed(() => (
  props.note.single ? props.note.single.status.kind === 'pending' : props.note.pendingDocumentCount > 0
));
const stateText = computed(() => {
  const single = props.note.single;
  if (!single) {
    return props.note.pendingDocumentCount > 0
      ? conversationMessage('conversation.runChanges.summaryPending', { count: props.note.pendingDocumentCount })
      : '';
  }
  const state = resolveRunDocumentChangeStateKey(single);
  return state ? conversationMessage(state.key, state.params) : '';
});

function handleClick(): void {
  const single = props.note.single;
  if (!single) {
    emit('toggle');
    return;
  }
  if (canOpenRunDocumentChange(single)) emit('open', single, resolveRunDocumentChangePrimaryIntent(single));
}
</script>
