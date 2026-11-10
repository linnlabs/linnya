<template>
  <div class="run-document-changes-list">
    <div
      v-for="item in visibleItems"
      :key="item.documentId"
      class="run-document-changes-row"
      :class="{ 'is-disabled': !canOpen(item) }"
      :role="canOpen(item) ? 'button' : undefined"
      :tabindex="canOpen(item) ? 0 : undefined"
      @click="openPrimary(item)"
      @keydown.enter.prevent="openPrimary(item)"
      @keydown.space.prevent="openPrimary(item)"
    >
      <component
        :is="item.iconComponent"
        class="run-document-changes-row__icon"
        :class="item.iconClass"
      />
      <span class="run-document-changes-row__main">
        <span class="run-document-changes-row__name">{{ resolveRunDocumentChangeDisplayTitle(item) }}</span>
        <span class="run-document-changes-row__meta">{{ conversationMessage(resolveRunDocumentChangeMetaKey(item)) }}</span>
      </span>
      <span
        class="run-document-changes-row__state"
        :class="{ 'is-pending': item.status.kind === 'pending' && canOpen(item) }"
      >{{ stateText(item) }}</span>
      <button
        v-if="actionKey(item)"
        type="button"
        class="run-document-changes-row__action"
        @click.stop="openAction(item)"
        @keydown.stop
      >
        {{ conversationMessage(actionKey(item)!) }}
      </button>
      <!-- 没有按钮的行留同宽占位，各行的状态词对齐。 -->
      <span
        v-else
        class="run-document-changes-row__action is-placeholder"
        aria-hidden="true"
      >
        {{ conversationMessage('conversation.runChanges.action.review') }}
      </span>
    </div>
    <button
      v-if="hiddenCount > 0"
      type="button"
      class="run-document-changes-list__more"
      @click="$emit('show-all')"
    >
      {{ conversationMessage('conversation.runChanges.showMore', { count: hiddenCount }) }}
    </button>
    <p
      v-if="truncated"
      class="run-document-changes-list__truncated"
    >
      {{ conversationMessage('conversation.runChanges.truncated') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type { RunDocumentChangeItem, RunDocumentChangeOpenIntent } from '../definitions/runDocumentChanges';
import {
  canOpenRunDocumentChange,
  resolveRunDocumentChangePrimaryIntent,
  RUN_DOCUMENT_CHANGES_VISIBLE_LIMIT,
} from '../functions/projectRunDocumentChangesNote';
import {
  resolveRunDocumentChangeActionKey,
  resolveRunDocumentChangeDisplayTitle,
  resolveRunDocumentChangeMetaKey,
  resolveRunDocumentChangeStateKey,
} from '../functions/resolveRunDocumentChangeLabels';

const props = defineProps<{
  items: readonly RunDocumentChangeItem[];
  showAll: boolean;
  truncated: boolean;
}>();

const emit = defineEmits<{
  open: [item: RunDocumentChangeItem, intent: RunDocumentChangeOpenIntent];
  'show-all': [];
}>();

const { conversationMessage } = useConversationLocalization();

const visibleItems = computed(() => (
  props.showAll ? props.items : props.items.slice(0, RUN_DOCUMENT_CHANGES_VISIBLE_LIMIT)
));
const hiddenCount = computed(() => props.items.length - visibleItems.value.length);

const canOpen = canOpenRunDocumentChange;
const actionKey = resolveRunDocumentChangeActionKey;

function stateText(item: RunDocumentChangeItem): string {
  const state = resolveRunDocumentChangeStateKey(item);
  return state ? conversationMessage(state.key, state.params) : '';
}

function openPrimary(item: RunDocumentChangeItem): void {
  if (canOpen(item)) emit('open', item, resolveRunDocumentChangePrimaryIntent(item));
}

function openAction(item: RunDocumentChangeItem): void {
  if (canOpen(item) && item.action) emit('open', item, item.action);
}
</script>
