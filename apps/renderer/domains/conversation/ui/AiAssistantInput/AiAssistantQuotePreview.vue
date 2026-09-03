<template>
  <!-- 引用展示区域：仅在存在用户引用时展示 -->
  <div
    v-if="hasConversationReference"
    class="ai-assistant-quote-preview"
  >
    <div class="ai-assistant-quote-preview__header">
      <span class="ai-assistant-quote-preview__label">
        {{ conversationMessage('conversation.quote.label') }}
      </span>
      <button
        type="button"
        class="ai-assistant-quote-preview__clear-button"
        @click.stop="onClearQuote"
      >
        {{ conversationMessage('conversation.quote.clear') }}
      </button>
    </div>
    <div class="ai-assistant-quote-preview__body">
      <div class="ai-assistant-quote-preview__list">
        <div
          v-for="chip in referenceChips"
          :key="chip.reference.id"
          class="ai-assistant-quote-preview__pill"
          :aria-label="chip.presentation.label"
        >
          <span class="ai-assistant-quote-preview__pill-text">{{ chip.presentation.preview }}</span>
          <button
            type="button"
            class="ai-assistant-quote-preview__pill-close"
            @click.stop="onRemoveReference(chip.reference.id)"
            :aria-label="conversationMessage('conversation.quote.remove')"
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import type { ConversationReference } from '../../types';
import {
  resolveConversationReferenceChipPresentation,
  useComposerReferences,
} from '../../features/composer-references';
import { useConversationLocalization } from '../useConversationLocalization';

const composerReferences = useComposerReferences();
const { conversationMessage } = useConversationLocalization();

const conversationReferences = computed<ConversationReference[]>(() => composerReferences.references.value);
const hasConversationReference = computed(() => conversationReferences.value.length > 0);
const referenceChips = computed(() => conversationReferences.value.map((reference) => ({
  reference,
  presentation: resolveConversationReferenceChipPresentation(reference),
})));

const onRemoveReference = (id: string) => {
  composerReferences.removeReference(id);
};

const onClearQuote = () => {
  composerReferences.clearReferences();
};
</script>
