<template>
  <div 
    class="status-message audio-status-message"
    :class="{
      'is-error': isError,
      'is-loading': isLoading,
      'is-success': isSuccess,
      'is-warning': isWarning,
      'is-info': !(isError || isLoading || isSuccess || isWarning)
    }"
  >
    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-indicator">
      <div class="spinner"></div>
    </div>
    
    <!-- 图标 -->
    <div v-if="iconType" class="status-icon">{{ iconType }}</div>
    
    <!-- 消息 -->
    <span>{{ message }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    default: 'info', // 'info', 'error', 'warning', 'success', 'loading'
    validator: (value) => ['info', 'error', 'warning', 'success', 'loading'].includes(value)
  },
  showIcon: {
    type: Boolean,
    default: true
  }
});

// 计算属性
const isError = computed(() => props.type === 'error');
const isWarning = computed(() => props.type === 'warning');
const isSuccess = computed(() => props.type === 'success');
const isLoading = computed(() => props.type === 'loading');

const iconType = computed(() => {
  if (!props.showIcon) return null;
  
  switch (props.type) {
    case 'error':
      return '❌';
    case 'warning':
      return '⚠️';
    case 'success':
      return '✅';
    case 'info':
      return 'ℹ️';
    default:
      return null;
  }
});
</script>
