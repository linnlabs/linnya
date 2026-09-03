<template>
  <div
    class="tool-error-card"
    :class="{ 'tool-error-card--actionable': actionLabel }"
  >
    <div class="tool-error-card__message">{{ errorMessage }}</div>
    <ActionButtons
      v-if="actionLabel"
      class="tool-error-card__actions"
      shape="pill"
      :primary-action-text="actionLabel"
      :primary-button-attributes="{ 'aria-label': actionLabel }"
      @primary-click="$emit('action')"
    />
  </div>
</template>

<script setup lang="ts">
import { ActionButtons } from '@linnya/renderer-ui';

/**
 * 通用工具错误卡片（ToolCallsMessage 专用）。
 *
 * 设计目标：
 * - 所有工具的 tool_output.status=error 都走统一展示；
 * - 工具自己的 UI 组件不需要再各自处理"执行失败"的渲染分支。
 */
defineProps<{
  errorMessage: string;
  actionLabel?: string;
}>();

defineEmits<{ action: [] }>();
</script>
