<!-- apps/renderer/features/AiAssistant/ui/message/SummaryMessage.vue -->
<template>
  <div class="summary-message" :class="summaryClasses">
    <div class="summary-content">
      <!-- 图标区域 -->
      <div class="summary-icon">
        <!-- 加载状态：显示涟漪加载动画 -->
        <RippleLoadingIcon
          v-if="summaryStatus === 'summarizing'"
          :color="'var(--color-info)'"
          :title="conversationMessage('conversation.summary.title.summarizing')"
        />
        
        <!-- 完成状态：显示成功图标 -->
        <OkIcon
          v-else-if="summaryStatus === 'completed'" 
          class="success-icon"
          :title="conversationMessage('conversation.summary.title.completed')"
        />
        
        <!-- 错误状态：显示错误图标 -->
        <span 
          v-else-if="summaryStatus === 'error'" 
          class="error-icon"
          :title="conversationMessage('conversation.summary.title.error')"
        >
          <!-- 🔥 使用 SVG 替换 Unicode 字符，以精确匹配设计 -->
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </span>
      </div>

      <!-- 消息文本 -->
      <div class="summary-text">
        {{ displayText }}
      </div>

      <!-- 时间戳 -->
      <div class="summary-timestamp">
        {{ formattedTimestamp }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RippleLoadingIcon } from '@linnya/renderer-ui/icons';
import { OkIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../useConversationLocalization';
import type { BaseMessage } from '../../types';

interface Props {
  message: Extract<BaseMessage, { type: 'history_summary' | 'summarization_progress' }>;
}

const props = defineProps<Props>();
const { currentLocale, conversationMessage } = useConversationLocalization();
const summaryStatus = computed(() => {
  return props.message.type === 'history_summary'
    ? 'completed' as const
    : props.message.metadata.summary.status;
});

// 🔥 根据状态显示固定文本，从设计上杜绝自定义文本
const displayText = computed(() => {
  switch (summaryStatus.value) {
    case 'summarizing':
      return conversationMessage('conversation.summary.text.summarizing');
    case 'completed':
      return conversationMessage('conversation.summary.text.completed');
    case 'error':
      return conversationMessage('conversation.summary.text.error');
  }
});

// CSS类计算
const summaryClasses = computed(() => [
  `summary-status-${summaryStatus.value}`,
  {
    'is-loading': summaryStatus.value === 'summarizing',
    'is-completed': summaryStatus.value === 'completed',
    'is-error': summaryStatus.value === 'error'
  }
]);

// 格式化时间戳
const formattedTimestamp = computed(() => {
  const date = new Date(props.message.timestamp);
  return date.toLocaleTimeString(currentLocale.value, {
    hour: '2-digit', 
    minute: '2-digit' 
  });
});
</script>
