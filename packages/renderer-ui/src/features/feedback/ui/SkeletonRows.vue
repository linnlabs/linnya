<!-- packages/renderer-ui/src/features/feedback/ui/SkeletonRows.vue -->
<template>
  <Skeleton :label="label" :delayed="delayed">
    <div class="linnya-ui-skeleton-rows" :class="`linnya-ui-skeleton-rows--${size}`">
      <div v-for="index in rows" :key="index" class="linnya-ui-skeleton-rows__row">
        <SkeletonBlock
          v-if="icon"
          class="linnya-ui-skeleton-rows__icon"
          :width="iconSize"
          :height="iconSize"
          :radius="size === 'lg' ? 'md' : 'sm'"
        />
        <div class="linnya-ui-skeleton-rows__text">
          <SkeletonBlock :width="lineWidth(index, 0)" />
          <SkeletonBlock v-if="size === 'lg'" :width="lineWidth(index, 1)" height="8px" />
        </div>
        <SkeletonBlock v-if="trailing" class="linnya-ui-skeleton-rows__trailing" width="28px" height="8px" />
      </div>
    </div>
  </Skeleton>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SkeletonRowsProps } from '../definitions/skeleton';
import Skeleton from './Skeleton.vue';
import SkeletonBlock from './SkeletonBlock.vue';

const props = withDefaults(defineProps<SkeletonRowsProps>(), {
  delayed: true,
  rows: 5,
  size: 'md',
  icon: false,
  trailing: false,
});

/* 固定的宽度序列：看起来像长短不一的真实标题，同时每次渲染保持一致，不随机抖动。 */
const TITLE_WIDTHS = ['68%', '52%', '80%', '60%', '44%', '72%', '56%', '64%'] as const;
const DETAIL_WIDTHS = ['86%', '74%', '90%', '66%', '80%'] as const;

const iconSize = computed(() => (props.size === 'lg' ? '32px' : '16px'));

function lineWidth(index: number, line: 0 | 1): string {
  const widths = line === 0 ? TITLE_WIDTHS : DETAIL_WIDTHS;
  return widths[(index - 1) % widths.length];
}
</script>
