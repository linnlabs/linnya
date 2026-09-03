<template>
  <div class="ask-question-actions questionnaire-actions">
    <div class="actions-left">
      <!-- 键盘快捷键提示 -->
      <div v-if="!isSubmitting && !isCompleted && hasQuestions" class="keyboard-hints">
        <span class="hint-item" :class="{ 'hint-disabled': !isFormValid }">
          <kbd>Ctrl</kbd> + <kbd>Enter</kbd> {{ conversationMessage('conversation.tool.askQuestions.shortcutSubmit') }}
        </span>
        <span class="hint-item">
          <kbd>ESC</kbd> {{ conversationMessage('conversation.tool.askQuestions.shortcutSkip') }}
        </span>
      </div>
    </div>

    <div class="actions-right">
      <!-- 已完成状态显示 -->
      <div v-if="isCompleted" class="completion-status">
        <div v-if="questionnaireStatus.type === 'submitted'" class="status-submitted">
          <OkIcon class="status-icon" />
          <span class="status-text">{{ conversationMessage('conversation.tool.askQuestions.submitted') }}</span>
          <span v-if="questionnaireStatus.timestamp" class="status-time">
            {{ formatTime(questionnaireStatus.timestamp) }}
          </span>
        </div>
        <div v-else-if="questionnaireStatus.type === 'skipped'" class="status-skipped">
          <span class="status-icon">⏭</span>
          <span class="status-text">{{ conversationMessage('conversation.tool.askQuestions.skipped') }}</span>
          <span v-if="questionnaireStatus.timestamp" class="status-time">
            {{ formatTime(questionnaireStatus.timestamp) }}
          </span>
        </div>
      </div>

      <!-- 未完成时显示操作按钮 -->
      <ActionButtons
        v-if="!isCompleted"
        :secondary-action-text="conversationMessage('conversation.tool.askQuestions.skipAction')"
        :primary-action-text="isSubmitting ? conversationMessage('conversation.tool.askQuestions.submitting') : submitLabel"
        :is-primary-action-disabled="isSubmitting || !isFormValid || !canRespond"
        :is-secondary-action-disabled="isSubmitting || !canRespond"
        @secondary-click="$emit('skip')"
        @primary-click="$emit('submit')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ActionButtons } from '@linnya/renderer-ui';
import { OkIcon } from '@linnya/renderer-ui/icons';
import type { QuestionnaireStatus } from '../definitions/questionnaire';
import type { ConversationMessageResolver } from '../../../../definitions/conversationMessages';
import { useConversationLocalization } from '../../../useConversationLocalization';

const props = defineProps<{
  isSubmitting: boolean;
  isCompleted: boolean;
  canRespond: boolean;
  isFormValid: boolean;
  hasQuestions: boolean;
  submitLabel: string;
  questionnaireStatus: QuestionnaireStatus;
  conversationMessage: ConversationMessageResolver;
}>();

const { currentLocale } = useConversationLocalization();
const { conversationMessage } = props;

defineEmits<{
  submit: [];
  skip: [];
}>();

// 格式化时间
const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString(currentLocale.value);
};
</script>
