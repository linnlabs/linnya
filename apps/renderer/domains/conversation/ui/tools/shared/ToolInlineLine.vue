<template>
  <!-- 不套卡片的工具单行：图标 + 文字（· 补充说明）；进行中用公共活动态文字。 -->
  <div
    class="tool-inline-line"
    :class="{ 'tool-inline-line--error': error }"
  >
    <component
      :is="icon"
      class="tool-inline-line__icon"
      v-bind="iconProps"
    />
    <ToolActivityIndicator
      v-if="loading"
      :running-label="text"
      effect="shimmer"
      compact
    />
    <span
      v-else
      class="tool-inline-line__text"
      :data-linnya-tooltip="tooltip"
    >
      {{ text }}<span
        v-if="meta"
        class="tool-inline-line__meta"
      > · {{ meta }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue';
import { ToolActivityIndicator } from '../../../shared/execution-presentation';

defineProps<{
  readonly icon: Component;
  /** 图标自己的必填属性，例如 EyeIcon 的 visible。 */
  readonly iconProps?: Record<string, unknown>;
  readonly text: string;
  readonly meta?: string;
  readonly loading?: boolean;
  readonly error?: boolean;
  readonly tooltip?: string;
}>();
</script>
