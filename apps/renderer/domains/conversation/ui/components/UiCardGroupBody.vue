<template>
  <div class="ui-card-body" :class="{ 'ui-card-body--bounded': bounded }">
    <!-- 超长 child trace 只渲染最近窗口；完整历史由用户明确选择后再展开。 -->
    <div v-if="omittedCount > 0" class="ui-card-body__window-hint">
      <span class="ui-card-body__window-hint-text">
        {{ conversationMessage('conversation.card.windowHint', { count: omittedCount }) }}
      </span>
      <button class="ui-card-body__window-hint-btn" type="button" @click.stop="$emit('show-all')">
        {{ conversationMessage('conversation.card.showAll') }}
      </button>
    </div>
    <Message
      v-for="child in visibleChildren"
      :key="child.id"
      :message="child"
      :is-streaming="isStreaming"
      @edit-message="$emit('edit-message', $event)"
      @regenerate-response="$emit('regenerate-response', $event)"
    />
    <slot v-if="visibleChildren.length === 0" name="empty" />

    <ConversationAnswerActions
      v-if="showActions"
      variant="card"
      :copy-title="conversationMessage('conversation.card.action.copyAnswer')"
      :save-title="conversationMessage('conversation.turn.action.saveAsDocument')"
      :copied-text="conversationMessage('conversation.turn.action.copied')"
      :saved-status-text="savedStatusText"
      :show-copied-text="showCopiedText"
      :show-saved-text="showSavedText"
      :is-saving="isSaving"
      @copy="$emit('copy')"
      @save="$emit('save')"
      @mouseenter="$emit('actions-mouseenter')"
    />
  </div>
</template>

<script setup lang="ts">
import type { BaseMessage } from '../../types';
import type {
  EditUserMessageCommand,
  RegenerateUserMessageCommand,
} from '../../definitions/userMessageContent';
import Message from '../Message.vue';
import ConversationAnswerActions from './ConversationAnswerActions.vue';
import { useConversationLocalization } from '../useConversationLocalization';

defineProps<{
  visibleChildren: readonly BaseMessage[];
  omittedCount: number;
  isStreaming: boolean;
  bounded: boolean;
  showActions: boolean;
  savedStatusText: string;
  showCopiedText: boolean;
  showSavedText: boolean;
  isSaving: boolean;
}>();

defineEmits<{
  'show-all': [];
  'copy': [];
  'save': [];
  'actions-mouseenter': [];
  'edit-message': [command: EditUserMessageCommand];
  'regenerate-response': [command: RegenerateUserMessageCommand];
}>();

const { conversationMessage } = useConversationLocalization();
</script>
