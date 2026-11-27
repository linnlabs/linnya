<template>
  <Teleport to="body">
    <div
      ref="panel"
      :style="position"
      @contextmenu.prevent
      @mousedown.stop
    >
      <CustomSelect
        :options="options"
        manual-mode
        enable-keyboard-nav
        semantic-role="menu"
        variant="minimal"
        min-width="170px"
        :trigger-aria-label="deckNavigatorMessage('slides.navigator.slideMenu')"
        @update:model-value="selectAction"
        @close="emit('close')"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, watch, onBeforeUnmount, ref } from 'vue';
import { onClickOutside, useEventListener } from '@vueuse/core';
import { createPointAnchor, CustomSelect, rendererUiOverlayLayer, useAnchoredPosition, type CustomSelectOption } from '@linnya/renderer-ui';
import type { SlideContextMenuAnchor } from '../definitions/deckNavigatorTypes';
import { useDeckNavigatorLocalization } from './useDeckNavigatorLocalization';

const props = defineProps<{ anchor: SlideContextMenuAnchor; disabled: boolean; canDelete: boolean; canMoveEarlier?: boolean; canMoveLater?: boolean }>();
const emit = defineEmits<{ duplicate: []; delete: []; moveEarlier: []; moveLater: []; close: [] }>();
const { deckNavigatorMessage } = useDeckNavigatorLocalization();
const panel = ref<HTMLElement | null>(null);
// 以右键位置为锚：底部缩略图的菜单放不下时翻到指针上方，并整体收进窗口，避免后几项落到窗口外。
const anchored = useAnchoredPosition({
  anchor: computed(() => createPointAnchor(props.anchor.x, props.anchor.y)),
  floating: panel,
  open: true,
  placement: { gap: 0 },
});
const position = computed(() => ({ ...anchored.style.value, zIndex: rendererUiOverlayLayer('portalMenu') }));
const options = computed<CustomSelectOption<string>[]>(() => [
  { value: 'duplicate', label: deckNavigatorMessage('slides.navigator.duplicateSlide'), disabled: props.disabled },
  { value: 'earlier', label: deckNavigatorMessage('slides.navigator.moveEarlier'), disabled: props.disabled || !props.canMoveEarlier },
  { value: 'later', label: deckNavigatorMessage('slides.navigator.moveLater'), disabled: props.disabled || !props.canMoveLater },
  { value: 'delete', label: deckNavigatorMessage('slides.navigator.deleteSlide'), disabled: props.disabled || !props.canDelete, variant: 'danger' },
]);
function selectAction(value: string | null): void {
  if (props.disabled) return;
  if (value === 'earlier' && props.canMoveEarlier) emit('moveEarlier');
  if (value === 'later' && props.canMoveLater) emit('moveLater');
  if (value === 'duplicate') emit('duplicate');
  if (value === 'delete' && props.canDelete) emit('delete');
}
onClickOutside(panel, () => emit('close'));
useEventListener(window, 'resize', () => emit('close'));
useEventListener(window, 'keydown', event => { if (event.key === 'Escape') emit('close'); });
watch(() => props.anchor, async () => {
  await nextTick();
  panel.value?.querySelector<HTMLElement>('[role="menu"] [role="menuitem"]:not([aria-disabled="true"])')?.focus();
}, { immediate: true });
onBeforeUnmount(() => { if (props.anchor.trigger.isConnected) props.anchor.trigger.focus({ preventScroll: true }); });
</script>
