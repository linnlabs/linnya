<template>
  <section
    class="slides-element-property-panel"
    :style="panelStyle"
    :aria-label="elementPropertyMessage('slides.elementProperties.label')"
    @pointerdown.stop
    @keydown.stop
  >
    <label
      v-if="canEditTextStyle"
      class="slides-element-property-panel__field"
    >
      <span>{{ elementPropertyMessage('slides.elementProperties.fontSize') }}</span>
      <CustomNumberInput
        v-model="fontSizePt"
        variant="panel"
        :input-width="72"
        min="1"
        max="400"
        step="1"
        :disabled="props.busy"
        @change="submitFontSize"
      />
    </label>

    <ElementColorControl
      v-if="canEditTextStyle || canEditFill"
      :key="`${target.authoringRef.slideKey}/${target.authoringRef.editKey}`"
      :color="canEditTextStyle ? currentTextColor : currentFillColor"
      :kind="canEditTextStyle ? 'text' : 'fill'"
      :label="elementPropertyMessage(canEditTextStyle ? 'slides.elementProperties.textColor' : 'slides.elementProperties.fillColor')"
      :disabled="props.busy"
      @select="submitColor"
    />

    <div
      v-if="canEditSize"
      class="slides-element-property-panel__size"
    >
      <label class="slides-element-property-panel__field">
        <span>{{ elementPropertyMessage('slides.elementProperties.width') }}</span>
        <CustomNumberInput
          v-model="width"
          variant="panel"
          :input-width="72"
          min="0.05"
          step="0.05"
          :disabled="props.busy"
          @change="syncVisualSize('width')"
        />
      </label>
      <label class="slides-element-property-panel__field">
        <span>{{ elementPropertyMessage('slides.elementProperties.height') }}</span>
        <CustomNumberInput
          v-model="height"
          variant="panel"
          :input-width="72"
          min="0.05"
          step="0.05"
          :disabled="props.busy"
          @change="syncVisualSize('height')"
        />
      </label>
      <span class="slides-element-property-panel__hint">{{ elementPropertyMessage('slides.elementProperties.sizeHint') }}</span>
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
import { CustomNumberInput, type NumberInputValue } from '@linnya/renderer-ui';
import type { ManualEditableTarget } from '../../manualEditing';
import ElementColorControl from './ElementColorControl.vue';
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
const fontSizePt = ref<NumberInputValue>(14);
const width = ref<NumberInputValue>(1);
const height = ref<NumberInputValue>(1);
const canEditTextStyle = computed(() => props.target.capabilities.includes('set_text_style'));
const canEditFill = computed(() => props.target.capabilities.includes('set_fill_color'));
const canEditSize = computed(() => props.target.capabilities.includes('set_visual_size'));
const canDeleteFrame = computed(() => (
  props.target.targetKind === 'frame' && props.target.capabilities.includes('delete')
));
const currentTextColor = computed(() => props.target.textEditing?.color ?? '#000000');
const currentFillColor = computed(() => (
  props.target.fill?.kind === 'solid' ? props.target.fill.color : null
));
const panelStyle = computed(() => resolveElementPropertyPanelStyle({
  slideLeft: props.slideLeft,
  slideTop: props.slideTop,
  scaledSlideWidth: props.scaledSlideWidth,
}));

const targetIdentity = computed(() => `${props.target.authoringRef.slideKey}/${props.target.authoringRef.editKey}`);
// 只同步真正变化的字段，颜色提交或版本刷新不能覆盖用户正在输入的尺寸。
watch([targetIdentity, () => props.target.textEditing?.fontSizePt], ([, value]) => {
  fontSizePt.value = value ?? 14;
}, { immediate: true });
watch([targetIdentity, () => props.target.visualSize?.width], ([, value]) => {
  width.value = value ?? 1;
}, { immediate: true });
watch([targetIdentity, () => props.target.visualSize?.height], ([, value]) => {
  height.value = value ?? 1;
}, { immediate: true });

function submitFontSize(): void {
  if (props.busy) return;
  const operation = createTextStyleOperation(props.target, { fontSizePt: Number(fontSizePt.value) });
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

function submitColor(color: string): void {
  if (props.busy) return;
  if (canEditTextStyle.value) submitTextColor(color);
  else submitFillColor(color);
}

function submitSize(): void {
  if (props.busy) return;
  const operation = createVisualSizeOperation(props.target, {
    width: Number(width.value),
    height: Number(height.value),
  });
  if (operation) emit('submit', operation);
}

function syncVisualSize(changedDimension: 'width' | 'height'): void {
  const committedSize = props.target.visualSize;
  if (!committedSize) return;
  const currentSize = props.target.targetKind === 'image'
    ? committedSize
    : { width: Number(width.value), height: Number(height.value) };
  const next = resolveVisualSizeAfterDimensionChange(
    props.target.targetKind,
    currentSize,
    changedDimension,
    Number(changedDimension === 'width' ? width.value : height.value),
  );
  if (!next) return;
  width.value = next.width;
  height.value = next.height;
  submitSize();
}

function submitDelete(): void {
  if (props.busy) return;
  const operation = createDeleteFrameOperation(props.target);
  if (operation) emit('submit', operation);
}
</script>
