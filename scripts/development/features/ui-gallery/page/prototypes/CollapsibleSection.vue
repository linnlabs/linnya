<script setup lang="ts">
import { useId } from 'vue';
import { ChevronIcon } from '@linnya/renderer-ui/icons';

/**
 * 候选组件原型：CollapsibleSection。标题按钮 + ChevronIcon（右 → 下）+ 内容展开动效，aria-expanded / aria-controls 内建。
 * 取代 24 个文件各自旋转箭头的写法。开合状态由调用方 v-model 持有。
 */
interface CollapsibleProps {
  readonly title: string;
  readonly meta?: string;
}

withDefaults(defineProps<CollapsibleProps>(), { meta: '' });
const open = defineModel<boolean>('open', { default: false });
const contentId = useId();
</script>

<template>
  <div class="proto-collapsible" :class="{ 'is-open': open }">
    <button
      type="button"
      class="proto-collapsible__header"
      :aria-expanded="open"
      :aria-controls="contentId"
      @click="open = !open"
    >
      <ChevronIcon class="proto-collapsible__chevron" :direction="open ? 'down' : 'right'" />
      <span class="proto-collapsible__title">{{ title }}</span>
      <span v-if="meta" class="proto-collapsible__meta">{{ meta }}</span>
    </button>
    <div :id="contentId" class="proto-collapsible__body" :inert="!open">
      <div class="proto-collapsible__inner"><slot /></div>
    </div>
  </div>
</template>

<style>
.proto-collapsible__header {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  width: 100%;
  height: var(--control-height-sm);
  padding: 0 var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-body);
  text-align: left;
  cursor: pointer;
}

.proto-collapsible__header:hover {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.proto-collapsible__header:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus-ring);
  outline-offset: 1px;
}

.proto-collapsible__chevron {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--color-text-tertiary);
}

.proto-collapsible__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proto-collapsible__meta {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

/* 用 grid 行高从 0fr 到 1fr 做展开动效，不需要测量内容高度。 */
.proto-collapsible__body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--duration-medium) var(--ease-standard);
}

.proto-collapsible.is-open .proto-collapsible__body {
  grid-template-rows: 1fr;
}

.proto-collapsible__inner {
  min-height: 0;
  overflow: hidden;
  padding-left: var(--space-5);
}

@media (prefers-reduced-motion: reduce) {
  .proto-collapsible__body {
    transition: none;
  }
}
</style>
