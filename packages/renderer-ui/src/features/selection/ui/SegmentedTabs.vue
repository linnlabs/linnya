<!-- packages/renderer-ui/src/features/selection/ui/SegmentedTabs.vue -->
<template>
  <div
    ref="listRef"
    class="segmented-tabs"
    :class="{ 'is-indicator-ready': isIndicatorReady }"
    :style="indicatorStyle"
    role="tablist"
    :aria-label="resolvedAriaLabel"
  >
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
    <span class="segmented-tabs__indicator" aria-hidden="true" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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

// 指示器只有一根，在页签之间滑动；位置按激活页签的实际排版量取，字体、数量或语言变化时重新量。
const listRef = ref<HTMLElement | null>(null);
const indicatorOffset = ref(0);
const indicatorWidth = ref(0);
// 首次量出位置前不显示指示器，也不播放滑动，避免它从 0 位置滑进来。
const isIndicatorReady = ref(false);
let resizeObserver: ResizeObserver | null = null;

const indicatorStyle = computed(() => ({
  '--segmented-tabs-indicator-x': `${indicatorOffset.value}px`,
  '--segmented-tabs-indicator-width': indicatorWidth.value,
}));

function measureIndicator(): void {
  const button = listRef.value?.querySelector<HTMLElement>('.segmented-tabs__button.is-active');
  if (button === null || button === undefined) {
    indicatorWidth.value = 0;
    return;
  }
  indicatorOffset.value = button.offsetLeft;
  indicatorWidth.value = button.offsetWidth;
}

function observeButtons(): void {
  if (resizeObserver === null) return;
  resizeObserver.disconnect();
  listRef.value?.querySelectorAll('.segmented-tabs__button').forEach(button => resizeObserver?.observe(button));
}

onMounted(() => {
  measureIndicator();
  // 下一帧再开启滑动，让首次位置直接落定。
  void nextTick(() => requestAnimationFrame(() => { isIndicatorReady.value = true; }));
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(measureIndicator);
    observeButtons();
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

watch(() => [props.modelValue, props.tabs], () => {
  void nextTick(() => {
    measureIndicator();
    observeButtons();
  });
}, { deep: true });

function selectTab(tabId: string): void {
  if (tabId === props.modelValue) {
    return;
  }
  emit('update:modelValue', tabId);
}
</script>
