<template>
  <!-- 菜单整包移到 body：画布容器的 overflow 与浮条的 transform 会让 fixed 子菜单错位、被裁切，
       聚焦到画面外的子菜单还会把画布容器滚走。与 Slides 元素浮条的菜单同一做法。 -->
  <Teleport to="body">
    <div
      ref="host"
      class="canvas-portal-menu"
      :style="style"
      @pointerdown.stop
      @contextmenu.prevent
      @keydown.stop
      @keydown.esc.stop.prevent="emit('close', 'escape')"
    >
      <CustomSelect
        :model-value="modelValue ?? null"
        :options="options"
        :manual-mode="true"
        :parent-is-open="true"
        :external-trigger-ref="trigger ?? null"
        semantic-role="menu"
        variant="minimal"
        :trigger-aria-label="label"
        :min-width="minWidth"
        :options-max-height="maxHeight"
        :show-selected-checkmark="showSelectedCheckmark"
        :options-motion-direction="opensUp ? 'up' : 'down'"
        @update:model-value="emit('select', $event)"
        @close="emit('close', 'outside')"
      />
    </div>
  </Teleport>
</template>
<script setup lang="ts" generic="Value extends string | number">
import { computed, onBeforeUnmount, onMounted, ref, type CSSProperties } from 'vue';
import { CustomSelect, type CustomSelectOption } from '@linnya/renderer-ui';
import type { CanvasMenuAnchor } from '../definitions/canvasMenu';
import { placeCanvasMenu } from '../functions/placeCanvasMenu';

const props = withDefaults(
  defineProps<{
    label: string;
    options: readonly CustomSelectOption<Value>[];
    anchor: CanvasMenuAnchor;
    modelValue?: Value | null;
    trigger?: HTMLElement | null;
    minWidth?: string;
    showSelectedCheckmark?: boolean;
  }>(),
  { modelValue: null, trigger: null, minWidth: '160px' }
);
const emit = defineEmits<{ select: [value: Value]; close: [reason: 'escape' | 'outside'] }>();
const host = ref<HTMLElement | null>(null),
  placed = ref<{ left: number; top: number } | null>(null);
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const maxHeight = computed(() => `${Math.max(120, viewport().height - 16)}px`);
// 底部控件的菜单翻到锚点上方时向上展开，动效方向与位置一致。
const opensUp = computed(() => (placed.value?.top ?? props.anchor.bottom) < props.anchor.top);
const style = computed<CSSProperties>(() => ({
  left: `${placed.value?.left ?? props.anchor.left}px`,
  top: `${placed.value?.top ?? props.anchor.bottom}px`,
  visibility: placed.value ? 'visible' : 'hidden',
}));
// 画布滚轮会平移或缩放视图，菜单锚点随之失效；与平台菜单一致，滚动与窗口变化即关闭。
const closeOnWheel = (event: WheelEvent) => {
  if (!(event.target instanceof Node) || !host.value?.contains(event.target))
    emit('close', 'outside');
};
const closeOnResize = () => emit('close', 'outside');
// 挂载时同步定位：CustomSelect 在下一拍聚焦第一项，此前菜单必须已可见，否则焦点留在触发按钮上，
// 方向键和 Esc 都落到画布。
onMounted(() => {
  window.addEventListener('wheel', closeOnWheel, { capture: true, passive: true });
  window.addEventListener('resize', closeOnResize);
  const size = host.value?.getBoundingClientRect();
  placed.value = size
    ? placeCanvasMenu(props.anchor, size, viewport())
    : { left: props.anchor.left, top: props.anchor.bottom };
});
onBeforeUnmount(() => {
  window.removeEventListener('wheel', closeOnWheel, { capture: true });
  window.removeEventListener('resize', closeOnResize);
});
</script>
