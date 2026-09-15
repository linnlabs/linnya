<template>
  <section
    class="slides-element-property-panel"
    :style="panelStyle"
    :aria-label="elementPropertyMessage('slides.elementProperties.label')"
    @pointerdown.stop
    @keydown.stop
  >
    <label v-if="canEditTextStyle" class="slides-element-property-panel__field">
      <span>{{ elementPropertyMessage('slides.elementProperties.fontSize') }}</span>
      <input
        v-model.number="fontSizePt"
        type="number"
        min="1"
        max="400"
        step="1"
        :disabled="props.busy"
        @change="submitFontSize"
      />
    </label>

    <ColorPickerPanel
      v-if="canEditTextStyle || canEditFill"
      :background-colors="ELEMENT_PROPERTY_COLOR_OPTIONS"
      :text-colors="ELEMENT_PROPERTY_COLOR_OPTIONS"
      :current-background-value="currentFillColor"
      :current-text-value="currentTextColor"
      :show-background="canEditFill"
      :show-text="canEditTextStyle"
      :show-clear-button="false"
      :background-title="elementPropertyMessage('slides.elementProperties.fillColor')"
      :text-title="elementPropertyMessage('slides.elementProperties.textColor')"
      :no-padding="true"
      compare-mode="by-resolved-hex"
      @select-background="submitFillColor($event.fallbackHex)"
      @select-text="submitTextColor($event.fallbackHex)"
    />

    <label v-if="canEditTextStyle || canEditFill" class="slides-element-property-panel__field">
      <span>{{ elementPropertyMessage('slides.elementProperties.customColor') }}</span>
      <input
        type="color"
        :value="canEditTextStyle ? currentTextColor : currentFillColor"
        :disabled="props.busy"
        @change="submitCustomColor"
      />
    </label>

    <div v-if="canEditSize" class="slides-element-property-panel__size">
      <label class="slides-element-property-panel__field">
        <span>{{ elementPropertyMessage('slides.elementProperties.width') }}</span>
        <input
          v-model.number="width"
          type="number"
          min="0.05"
          step="0.05"
          :disabled="props.busy"
          @change="syncVisualSize('width')"
        />
      </label>
      <label class="slides-element-property-panel__field">
        <span>{{ elementPropertyMessage('slides.elementProperties.height') }}</span>
        <input
          v-model.number="height"
          type="number"
          min="0.05"
          step="0.05"
          :disabled="props.busy"
          @change="syncVisualSize('height')"
        />
      </label>
      <button type="button" :disabled="props.busy" @click="submitSize">
        {{ elementPropertyMessage('slides.elementProperties.applySize') }}
      </button>
    </div>

    <button
      v-if="canDeleteFrame"
      type="button"
      class="slides-element-property-panel__delete"
      :disabled="props.busy"
      @click="submitDelete"
    >
      {{ elementPropertyMessage('slides.elementProperties.deleteFrame') }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ColorPickerPanel } from '@linnya/renderer-ui';
import type { ManualEditableTarget } from '../../manualEditing';
import { ELEMENT_PROPERTY_COLOR_OPTIONS } from '../definitions/elementPropertyPalette';
import type { ElementPropertyOperation } from '../definitions/elementPropertyTypes';
import {
  createDeleteFrameOperation,
  createFillColorOperation,
  createTextStyleOperation,
  createVisualSizeOperation,
  resolveVisualSizeAfterDimensionChange,
} from '../functions/elementPropertyOperations';
import { resolveElementPropertyPanelStyle } from '../functions/resolveElementPropertyPanelStyle';
import { useElementPropertyLocalization } from './useElementPropertyLocalization';

const props = defineProps<{
  target: ManualEditableTarget;
  slideLeft: number;
  slideTop: number;
  scaledSlideWidth: number;
  busy?: boolean;
}>();

const emit = defineEmits<{
  submit: [operation: ElementPropertyOperation];
}>();

const { elementPropertyMessage } = useElementPropertyLocalization();
const fontSizePt = ref(14);
const width = ref(1);
const height = ref(1);
const canEditTextStyle = computed(() => props.target.capabilities.includes('set_text_style'));
const canEditFill = computed(() => props.target.capabilities.includes('set_fill_color'));
const canEditSize = computed(() => props.target.capabilities.includes('set_visual_size'));
const canDeleteFrame = computed(() => (
  props.target.targetKind === 'frame' && props.target.capabilities.includes('delete')
));
const currentTextColor = computed(() => props.target.textEditing?.color ?? '#000000');
const currentFillColor = computed(() => (
  props.target.fill?.kind === 'solid' ? props.target.fill.color : '#000000'
));
const panelStyle = computed(() => resolveElementPropertyPanelStyle({
  slideLeft: props.slideLeft,
  slideTop: props.slideTop,
  scaledSlideWidth: props.scaledSlideWidth,
}));

watch(
  () => props.target,
  (target) => {
    fontSizePt.value = target.textEditing?.fontSizePt ?? 14;
    width.value = target.visualSize?.width ?? 1;
    height.value = target.visualSize?.height ?? 1;
  },
  { immediate: true },
);

function submitFontSize(): void {
  if (props.busy) return;
  const operation = createTextStyleOperation(props.target, { fontSizePt: fontSizePt.value });
  if (operation) emit('submit', operation);
}

function submitTextColor(color: string): void {
  if (props.busy) return;
  const operation = createTextStyleOperation(props.target, { color });
  if (operation) emit('submit', operation);
}

function submitFillColor(color: string): void {
  if (props.busy) return;
  const operation = createFillColorOperation(props.target, color);
  if (operation) emit('submit', operation);
}

function submitCustomColor(event: Event): void {
  if (props.busy) return;
  if (!(event.target instanceof HTMLInputElement)) return;
  if (canEditTextStyle.value) submitTextColor(event.target.value);
  else submitFillColor(event.target.value);
}

function submitSize(): void {
  if (props.busy) return;
  const operation = createVisualSizeOperation(props.target, {
    width: width.value,
    height: height.value,
  });
  if (operation) emit('submit', operation);
}

function syncVisualSize(changedDimension: 'width' | 'height'): void {
  const committedSize = props.target.visualSize;
  if (!committedSize) return;
  const currentSize = props.target.targetKind === 'image'
    ? committedSize
    : { width: width.value, height: height.value };
  const next = resolveVisualSizeAfterDimensionChange(
    props.target.targetKind,
    currentSize,
    changedDimension,
    changedDimension === 'width' ? width.value : height.value,
  );
  if (!next) return;
  width.value = next.width;
  height.value = next.height;
}

function submitDelete(): void {
  if (props.busy) return;
  const operation = createDeleteFrameOperation(props.target);
  if (operation) emit('submit', operation);
}
</script>

<style src="./ElementPropertyPanel.css"></style>
