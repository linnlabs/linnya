<template>
  <div class="taskstate-card">
    <!-- 加载中 -->
    <div v-if="status === 'loading'" class="ts-state">
      <div class="ts-spinner"></div>
      <span>{{ loadingText }}</span>
    </div>

    <!-- 成功 -->
    <div v-else-if="status === 'success'" class="ts-content">
      <!-- 未创建 -->
      <div v-if="exists === false" class="ts-empty">
        {{ conversationMessage('conversation.tool.taskState.notCreated') }}
      </div>

      <!-- 已创建 -->
      <template v-else>
        <!-- 顶部 meta：阶段 · 计划/步骤统计 · 打开链接 -->
        <div class="ts-meta-row">
          <div class="ts-meta-left">
            <span class="ts-meta-seg">{{ phaseText }}</span>
            <span class="ts-meta-seg">{{ planCountText }}</span>
            <span class="ts-meta-seg">{{ nextStepsCountText }}</span>
          </div>
        </div>

        <!-- 核心信息：Goal -->
        <div v-if="goal" class="ts-goal">{{ goal }}</div>

        <!-- 紧凑列表：Next Steps（最多 3 条） -->
        <div v-if="nextStepRows.length > 0" class="ts-steps">
          <div v-for="step in nextStepRows" :key="step.id" class="ts-step-row">
            <div class="ts-step-bar-wrap"><div class="ts-step-bar"></div></div>
            <span class="ts-step-text">{{ step.text }}</span>
          </div>
        </div>
      </template>
    </div>

    <!-- 错误 -->
    <div v-else-if="status === 'error'" class="ts-state ts-state--error">
      {{ errorMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type { TaskStatePresentationData } from './definitions/taskStatePresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<TaskStatePresentationData>;
  messageId?: string;
}>();

const { conversationMessage } = useConversationLocalization();

const status = computed(() => props.presentation.status);
const data = computed(() => props.presentation.data);

const exists = computed<boolean | undefined>(() => {
  if (data.value.kind === 'missing') return false;
  if (data.value.kind === 'snapshot') return true;
  return undefined;
});

const loadingText = computed(() => {
  if (data.value.operation === 'write') {
    return conversationMessage('conversation.tool.taskState.loadingUpdate');
  }
  return conversationMessage('conversation.tool.taskState.loadingRead');
});

const goal = computed(() => data.value.kind === 'snapshot' ? data.value.taskstate.goal : '');
const phaseText = computed(() => (
  data.value.kind === 'snapshot' ? data.value.taskstate.current_phase : ''
));
const planCountText = computed(() => conversationMessage('conversation.tool.taskState.planCount', {
  count: data.value.kind === 'snapshot' ? data.value.taskstate.current_plan.length : 0,
}));
const nextStepsCountText = computed(() => conversationMessage('conversation.tool.taskState.nextStepCount', {
  count: data.value.kind === 'snapshot' ? data.value.taskstate.next_steps.length : 0,
}));
const nextStepRows = computed(() => (
  data.value.kind === 'snapshot' ? data.value.nextStepRows : []
));

const errorMessage = computed(() => {
  return conversationMessage('conversation.tool.taskState.failed');
});

</script>
