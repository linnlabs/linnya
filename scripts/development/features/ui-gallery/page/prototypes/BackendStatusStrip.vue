<script setup lang="ts">
import { InfoIcon, LoadingIcon, CheckmarkIcon } from '@linnya/renderer-ui/icons';

/**
 * 后台服务状态条（W-0449 原型）：App Server 停止、重启、无响应时，整个窗口共用的一条提示。
 * 放在主区域顶部（推荐）或右下角卡片（对照）。不是真实组件。
 */
withDefaults(
  defineProps<{
    readonly tone: 'progress' | 'warning' | 'error' | 'success';
    readonly text: string;
    readonly placement?: 'top' | 'corner';
  }>(),
  { placement: 'top' },
);

defineSlots<{ actions(): unknown }>();
</script>

<template>
  <div class="backend-strip" :class="[`is-${tone}`, `is-${placement}`]" role="status">
    <span class="backend-strip__icon" aria-hidden="true">
      <LoadingIcon v-if="tone === 'progress'" />
      <CheckmarkIcon v-else-if="tone === 'success'" />
      <InfoIcon v-else />
    </span>
    <span class="backend-strip__text">{{ text }}</span>
    <span v-if="$slots.actions" class="backend-strip__actions"><slot name="actions" /></span>
  </div>
</template>

<style scoped>
.backend-strip {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: 36px; /* scale-exempt: 与侧栏行同高 */
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
  color: var(--color-text-primary);
  font-size: var(--font-size-footnote);
  border-radius: var(--radius-sm);
}

.backend-strip.is-progress {
  background-color: var(--color-bg-hover);
}

.backend-strip.is-warning {
  background-color: var(--color-warning-bg);
}

.backend-strip.is-error {
  background-color: var(--color-error-bg);
}

.backend-strip.is-success {
  background-color: var(--color-success-bg);
}

.backend-strip.is-corner {
  flex-wrap: wrap;
  width: 300px; /* scale-exempt: 与右下角提示同宽 */
  padding: var(--space-2-5) var(--space-3);
  background-color: var(--color-bg-surface);
  box-shadow: var(--shadow-md);
}

.backend-strip__icon {
  display: inline-flex;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: var(--color-text-secondary);
}

.backend-strip__icon > svg {
  width: 16px;
  height: 16px;
}

.is-warning .backend-strip__icon {
  color: var(--color-warning-text);
}

.is-error .backend-strip__icon {
  color: var(--color-error-text);
}

.is-success .backend-strip__icon {
  color: var(--color-success-text);
}

.backend-strip__text {
  flex: 1;
  min-width: 0;
}

.is-corner .backend-strip__text {
  flex-basis: calc(100% - 24px); /* scale-exempt: 图标列 */
}

.backend-strip__actions {
  display: inline-flex;
  flex-shrink: 0;
  gap: var(--space-1);
}

.is-corner .backend-strip__actions {
  justify-content: flex-end;
  width: 100%;
}
</style>
