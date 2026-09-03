<template>
  <!--
    ask 交互约束：
    - loading 阶段可能会先收到“占位 action(start)”（用于提前创建 tool_calls 消息）；
    - 若此时没有任何内容，展示“正在创建提问......”占位符；
    - 一旦有内容（标题或题目），立即进入内容渲染模式。
  -->
  <div class="ask-questions-card questionnaire-renderer">
    <!-- 加载占位 -->
    <div v-if="isLoading" class="loading-state">
      <span class="loading-text">{{ conversationMessage('conversation.tool.askQuestions.loading') }}</span>
    </div>

    <!-- 真实内容区域 -->
    <template v-else>
      <!-- 问卷标题和描述 -->
      <QuestionnaireHeader :title="questionnaireData.title" :description="questionnaireData.description" />

      <!-- 全局错误（例如缺少 toolCallId） -->
      <div v-if="validationErrors['__global__']" class="global-error">
        {{ validationErrors['__global__'] }}
      </div>

      <!-- 问题列表 -->
      <div class="questions-container" :class="{ 'questions-disabled': isCompleted }">
        <QuestionItem
          v-for="(question, index) in questionnaireData.questions"
          :key="question.id"
          :question="question"
          :index="index"
          :is-completed="isCompleted"
          :answers="answers"
          :multi-answers="multiAnswers"
          :text-answers="textAnswers"
          :other-answers="otherAnswers"
          :validation-errors="validationErrors"
          :conversation-message="conversationMessage"
          :update-single-answer="updateSingleAnswer"
          :update-multi-answer="updateMultiAnswer"
          :update-text-answer="updateTextAnswer"
          :update-other-answer="updateOtherAnswer"
        />
      </div>

      <!-- 操作按钮 -->
      <QuestionActions
        :is-submitting="isSubmitting"
        :is-completed="isCompleted"
        :can-respond="canRespond"
        :is-form-valid="isFormValid"
        :has-questions="questionnaireData.questions.length > 0"
        :submit-label="questionnaireData.submitLabel"
        :questionnaire-status="questionnaireStatus"
        :conversation-message="conversationMessage"
        @submit="handleSubmit"
        @skip="handleSkip"
      />

      <!-- 空状态或错误状态（非执行中） -->
      <div v-if="shouldShowEmptyState" class="empty-state">
        <div class="empty-content">
          <h4>{{ conversationMessage('conversation.tool.askQuestions.emptyTitle') }}</h4>
          <p>{{ emptyStateText }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import QuestionActions from './components/QuestionActions.vue';
import QuestionItem from './components/QuestionItem.vue';
import QuestionnaireHeader from './components/QuestionnaireHeader.vue';
import { useQuestionnaire } from './composables/useQuestionnaire';
import type { AskPresentationData } from './definitions/questionnaire';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';

const props = defineProps<{
  presentation: ToolCardPresentation<AskPresentationData>;
}>();
const { conversationMessage } = useConversationLocalization();

const {
  isSubmitting,
  validationErrors,
  isFormValid,
  questionnaireData,
  questionnaireStatus,
  isCompleted,
  canRespond,
  emptyStateText,

  answers,
  multiAnswers,
  textAnswers,
  otherAnswers,

  updateSingleAnswer,
  updateMultiAnswer,
  updateTextAnswer,
  updateOtherAnswer,

  handleSubmit,
  handleSkip,
  handleKeyDown,
} = useQuestionnaire(props, conversationMessage);

const hasContent = computed(() => {
  return (
    !!questionnaireData.value.title ||
    !!questionnaireData.value.description ||
    questionnaireData.value.questions.length > 0 ||
    !!validationErrors['__global__']
  );
});

const isLoading = computed(() => {
  // 仅在执行中且完全无内容时显示加载态
  return props.presentation.status === 'loading' && !hasContent.value;
});

const shouldShowEmptyState = computed(() => {
  // loading 阶段不展示“暂无问题”（要么是 loading，要么是内容）
  if (props.presentation.status === 'loading') return false;
  return questionnaireData.value.questions.length === 0;
});

// 说明：仅用于问卷快捷键交互（提交/跳过）。不添加临时 console 调试日志。
onMounted(() => {
  document.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown);
});
</script>
