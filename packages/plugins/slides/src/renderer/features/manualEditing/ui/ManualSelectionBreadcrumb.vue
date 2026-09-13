<template>
  <nav
    class="slides-manual-selection-breadcrumb"
    :style="positionStyle"
    :aria-label="props.label"
    @pointerdown.stop
  >
    <template v-for="(target, index) in props.path" :key="target.elementId">
      <span v-if="index > 0" class="slides-manual-selection-breadcrumb__separator">›</span>
      <button
        type="button"
        class="slides-manual-selection-breadcrumb__item"
        :class="{ 'is-active': target.elementId === props.selectedElementId }"
        :title="`${target.targetKind}: ${target.authoringRef.editKey}`"
        @click="emit('select', target)"
      >
        {{ target.targetKind === 'frame' ? 'Frame' : target.authoringRef.editKey }}
      </button>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';
import { resolveManualSelectionBreadcrumbStyle } from '../functions/resolveManualSelectionBreadcrumbStyle';

const props = defineProps<{
  path: readonly ManualEditableTarget[];
  selectedElementId: string;
  slideLeft: number;
  slideTop: number;
  renderScale: number;
  label: string;
}>();

const emit = defineEmits<{
  select: [target: ManualEditableTarget];
}>();

const positionStyle = computed(() => {
  const target = props.path[0];
  if (!target) return {};
  return resolveManualSelectionBreadcrumbStyle(target, {
    slideLeft: props.slideLeft,
    slideTop: props.slideTop,
    renderScale: props.renderScale,
  });
});
</script>

<style src="./ManualSelectionBreadcrumb.css"></style>
