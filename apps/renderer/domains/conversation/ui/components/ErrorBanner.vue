<!-- ErrorBanner.vue -->
<template>
  <div v-if="error" class="error-banner">
    <!-- 错误面板头部 -->
    <div class="error-header">
      <span class="error-title">{{ conversationMessage('conversation.error.title') }}</span>
      <button
        class="error-dismiss"
        @click="$emit('dismiss')"
        :title="conversationMessage('conversation.error.close')"
      >
        <CloseIcon />
      </button>
    </div>
    
    <!-- 错误文本内容 -->
    <div class="error-body">
      <div class="error-text">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CloseIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../useConversationLocalization';

/**
 * 功能 (What): 错误横幅组件，显示错误信息并提供关闭功能
 * 输入 (Input): error - 错误信息字符串
 * 输出 (Output): 渲染错误横幅UI
 * 副作用 (Side-effects): 支持通过emit触发dismiss事件
 */

// Props
interface Props {
  error?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  error: null
});

// Events
interface Emits {
  (e: 'dismiss'): void;
}

defineEmits<Emits>();

const { conversationMessage } = useConversationLocalization();
</script>
