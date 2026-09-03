<!-- packages/renderer-ui/src/features/selection/ui/SegmentedTabs.vue -->
<template>
  <div class="segmented-tabs" role="tablist" :aria-label="resolvedAriaLabel">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="segmented-tabs__button"
      :class="{ 'is-active': tab.id === modelValue }"
      type="button"
      role="tab"
      :aria-selected="tab.id === modelValue"
      :disabled="tab.disabled"
      @click="selectTab(tab.id)"
    >
      <span>{{ tab.label }}</span>
      <span v-if="tab.count !== undefined" class="segmented-tabs__count">
        {{ tab.count }}
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSharedComponentLocalization } from '@linnya/renderer-ui/localization';
import type { SegmentedTabItem } from '../definitions/segmentedTabItem';

const props = withDefaults(defineProps<{
  modelValue: string;
  tabs: readonly SegmentedTabItem[];
  ariaLabel?: string;
}>(), {
  ariaLabel: '',
});

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
}>();
const { sharedComponentMessage } = useSharedComponentLocalization();

const resolvedAriaLabel = computed(() => (
  props.ariaLabel || sharedComponentMessage('shared.segmentedTabs.ariaLabel')
));

function selectTab(tabId: string): void {
  if (tabId === props.modelValue) {
    return;
  }
  emit('update:modelValue', tabId);
}
</script>
