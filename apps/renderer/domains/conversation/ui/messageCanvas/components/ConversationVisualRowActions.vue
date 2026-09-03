<template>
  <ConversationAnswerActions
    v-if="answers.length > 0"
    :variant="variant"
    :copy-title="conversationMessage(variant === 'card' ? 'conversation.card.action.copyAnswer' : 'conversation.turn.action.copyAnswer')"
    :save-title="conversationMessage('conversation.turn.action.saveAsDocument')"
    :copied-text="conversationMessage('conversation.turn.action.copied')"
    :saved-status-text="savedStatusText"
    :show-copied-text="showCopiedText"
    :show-saved-text="showSavedText"
    :is-saving="isSavingAsDocument"
    :disabled="isStreaming"
    @copy="copyAnswers"
    @save="saveAsDocument"
    @mouseenter="resetTransientStatus"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BaseMessage } from '../../../types';
import type { ConversationMessageKey } from '../../../definitions/conversationMessages';
import { findCitationInMessages } from '../../../features/citation-presentation';
import { useConversationLocalization } from '../../useConversationLocalization';
import ConversationAnswerActions from '../../components/ConversationAnswerActions.vue';
import {
  copyRenderedAnswersToClipboard,
  exportRenderedAnswersAsDocument,
  useRenderedAnswerTransfer,
} from '../../tools/knowledge/clipboard';

type SaveStatus = 'saved' | 'saving' | 'empty' | 'failed';

const props = defineProps<{
  answers: readonly BaseMessage[];
  isStreaming: boolean;
  variant: 'card' | 'turn';
}>();

const { conversationMessage } = useConversationLocalization();
const renderedAnswerTransfer = useRenderedAnswerTransfer();
const showCopiedText = ref(false);
const showSavedText = ref(false);
const isSavingAsDocument = ref(false);
const savedStatus = ref<SaveStatus>('saved');
const statusMessageKeys: Readonly<Record<SaveStatus, ConversationMessageKey>> = {
  saved: 'conversation.turn.saveStatus.saved',
  saving: 'conversation.turn.saveStatus.saving',
  empty: 'conversation.turn.saveStatus.empty',
  failed: 'conversation.turn.saveStatus.failed',
};
const savedStatusText = computed(() => conversationMessage(statusMessageKeys[savedStatus.value]));

function resetTransientStatus(): void {
  showCopiedText.value = false;
  showSavedText.value = false;
}

async function copyAnswers(): Promise<void> {
  const answers = props.answers;
  if (answers.length === 0) return;
  const result = await renderedAnswerTransfer.withRenderedAnswers({ answers }, session => (
    copyRenderedAnswersToClipboard({
      containerEl: session.containerEl,
      plainText: session.plainText,
      copyScope: props.variant === 'card' ? 'card-answer' : 'turn-answer',
      answerMessageIds: session.answerMessageIds,
      findCitationByRef: (runtimeTurnId, ref) => (
        findCitationInMessages(answers, runtimeTurnId, ref)
      ),
      generateCitationId: () => globalThis.crypto.randomUUID(),
      conversationMessage,
    })
  ));
  if (!result.success) {
    console.error('[ConversationVisualRowActions] 复制失败', { error: result.error });
    return;
  }
  showCopiedText.value = true;
  window.setTimeout(() => {
    showCopiedText.value = false;
  }, 2000);
}

async function saveAsDocument(): Promise<void> {
  if (isSavingAsDocument.value || props.answers.length === 0) return;
  isSavingAsDocument.value = true;
  savedStatus.value = 'saving';
  showSavedText.value = true;
  try {
    const result = await renderedAnswerTransfer.withRenderedAnswers({ answers: props.answers }, session => (
      exportRenderedAnswersAsDocument({
        containerEl: session.containerEl,
        plainText: session.plainText,
        copyScope: props.variant === 'card' ? 'card-answer' : 'turn-answer',
        answerMessageIds: session.answerMessageIds,
        findCitationByRef: (runtimeTurnId, ref) => (
          findCitationInMessages(props.answers, runtimeTurnId, ref)
        ),
        generateCitationId: () => globalThis.crypto.randomUUID(),
        conversationMessage,
      })
    ));
    savedStatus.value = result.success ? 'saved' : 'failed';
    if (!result.success) {
      console.error('[ConversationVisualRowActions] 转存失败', { error: result.error });
    }
  } catch (error) {
    savedStatus.value = 'failed';
    console.error('[ConversationVisualRowActions] 转存异常', { error });
  } finally {
    isSavingAsDocument.value = false;
    window.setTimeout(() => {
      showSavedText.value = false;
    }, savedStatus.value === 'failed' ? 3000 : 2000);
  }
}
</script>
