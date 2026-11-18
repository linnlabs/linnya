<script setup lang="ts">
/**
 * 候选组件原型：EmptyState。
 * - inline：列表、侧栏里的一行提示（取代侧栏、文件搜索、技能列表各自的 footnote 灰字）；
 * - page：页面或面板中央的空状态，图标 + 标题 + 说明 + 操作（取代插件商店、对话、项目页各自的排版）。
 */
interface EmptyStateProps {
  readonly variant?: 'inline' | 'page';
  readonly title?: string;
  readonly description?: string;
}

withDefaults(defineProps<EmptyStateProps>(), { variant: 'page', title: '', description: '' });
</script>

<template>
  <div class="proto-empty-state" :class="`proto-empty-state--${variant}`" role="status">
    <div v-if="variant === 'page' && $slots.icon" class="proto-empty-state__icon" aria-hidden="true"><slot name="icon" /></div>
    <p v-if="title" class="proto-empty-state__title">{{ title }}</p>
    <p v-if="description" class="proto-empty-state__description">{{ description }}</p>
    <div v-if="variant === 'page' && $slots.action" class="proto-empty-state__action"><slot name="action" /></div>
  </div>
</template>

<style>
.proto-empty-state p {
  margin: 0;
}

.proto-empty-state--inline {
  padding: var(--space-1-5) var(--space-2);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-footnote);
}

.proto-empty-state--inline .proto-empty-state__title {
  display: inline;
}

.proto-empty-state--page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-10) var(--space-6);
  text-align: center;
}

.proto-empty-state__icon {
  display: flex;
  margin-bottom: var(--space-1);
  color: var(--color-text-tertiary);
}

.proto-empty-state__icon svg {
  width: 32px;
  height: 32px;
}

.proto-empty-state--page .proto-empty-state__title {
  color: var(--color-text-primary);
  font-size: var(--font-size-subtitle);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-subtitle);
}

.proto-empty-state--page .proto-empty-state__description {
  max-width: 320px; /* scale-exempt: 说明文字行宽 */
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-footnote);
}

.proto-empty-state__action {
  margin-top: var(--space-2);
}
</style>
