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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  CustomSelect,
  useAnchoredPosition,
  type AnchoredAnchor,
  type CustomSelectOption,
} from '@linnya/renderer-ui';
import type { CanvasMenuAnchor } from '../definitions/canvasMenu';

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
const host = ref<HTMLElement | null>(null);
const maxHeight = computed(() => `${Math.max(120, window.innerHeight - 16)}px`);
// 锚点是视口坐标的矩形（按钮矩形或右键位置），交给统一定位：默认在下方，放不下翻到上方，再收进视口。
const anchorRect = computed<AnchoredAnchor>(() => {
  const { left, top, right, bottom } = props.anchor;
  const rect = new DOMRect(left, top, right - left, bottom - top);
  return { getBoundingClientRect: () => rect };
});
const { style, side } = useAnchoredPosition({
  anchor: anchorRect,
  floating: host,
  open: true,
  placement: () => ({ side: 'bottom', align: props.anchor.align, gap: 4 }),
});
// 底部控件的菜单翻到锚点上方时向上展开，动效方向与位置一致。
const opensUp = computed(() => side.value === 'top');
// 画布滚轮会平移或缩放视图，菜单锚点随之失效；与平台菜单一致，滚动与窗口变化即关闭。
const closeOnWheel = (event: WheelEvent) => {
  if (!(event.target instanceof Node) || !host.value?.contains(event.target))
    emit('close', 'outside');
};
const closeOnResize = () => emit('close', 'outside');
// 菜单一挂载就可见（统一定位不隐藏未定位的浮层）：CustomSelect 在下一拍聚焦第一项，菜单不可见时
// 焦点会留在触发按钮上，方向键和 Esc 都落到画布。
onMounted(() => {
  window.addEventListener('wheel', closeOnWheel, { capture: true, passive: true });
  window.addEventListener('resize', closeOnResize);
});
onBeforeUnmount(() => {
  window.removeEventListener('wheel', closeOnWheel, { capture: true });
  window.removeEventListener('resize', closeOnResize);
});
</script>
