<template>
  <div class="conversation-reference-suggestion">
    <CustomSelect
      v-if="items.length > 0"
      ref="selectRef"
      :model-value="null"
      :options="selectOptions"
      :manual-mode="true"
      :enable-keyboard-nav="true"
      :on-select="handleSelect"
      min-width="280px"
      options-max-height="320px"
      options-overflow="auto"
    />
    <div
      v-else
      class="conversation-reference-suggestion__empty"
    >
      {{ conversationMessage('conversation.input.mention.empty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@tiptap/suggestion';
import { CustomSelect } from '@linnya/renderer-ui';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { ConversationReferenceSuggestionItem } from '../definitions/conversationReferenceSuggestion';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';

interface KeyboardNavigableSelect {
  onKeyDown: typeof onKeyDown;
}

const componentProps = defineProps<{
  items: ConversationReferenceSuggestionItem[];
  command: SuggestionProps<ConversationReferenceSuggestionItem>['command'];
}>();

const selectRef = ref<KeyboardNavigableSelect | null>(null);
const { conversationMessage } = useConversationLocalization();

const selectOptions = computed<CustomSelectOption[]>(() => componentProps.items.map(item => ({
  value: item.key,
  text: item.candidate.label,
  shortcut: item.candidate.description,
  iconComponent: item.candidate.icon,
})));

function handleSelect(value: unknown): void {
  if (typeof value !== 'string') return;
  const item = componentProps.items.find(candidate => candidate.key === value);
  if (item) componentProps.command(item);
}

function onKeyDown(input: SuggestionKeyDownProps): boolean {
  return selectRef.value?.onKeyDown(input) ?? false;
}

defineExpose({ onKeyDown });
</script>
