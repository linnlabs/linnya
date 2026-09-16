<template>
  <div class="slides-element-color">
    <fieldset
      class="slides-element-color__palette"
      :disabled="disabled"
    >
      <ColorPickerPanel
        :background-colors="ELEMENT_PROPERTY_COLOR_OPTIONS"
        :text-colors="ELEMENT_PROPERTY_COLOR_OPTIONS"
        :current-background-value="color"
        :current-text-value="color"
        :show-background="kind === 'fill'"
        :show-text="kind === 'text'"
        :background-title="label"
        :text-title="label"
        :show-clear-button="false"
        :no-padding="true"
        compare-mode="by-value"
        @select-background="selectPreset($event.value)"
        @select-text="selectPreset($event.value)"
      />
    </fieldset>
    <button
      ref="trigger"
      class="slides-element-color__custom"
      :class="{ 'slides-element-color__custom--current': isCustom }"
      type="button"
      :aria-pressed="isCustom"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggle"
    >
      <span
        class="slides-element-color__swatch"
        :style="{ '--slides-custom-color': color ?? 'transparent' }"
      />
      <span class="slides-element-color__caption">
        {{ message('slides.elementProperties.customColor') }}
        <span class="slides-element-color__value">{{ color ?? message('slides.elementProperties.mixedColor') }}</span>
      </span>
      <span
        v-if="isCustom"
        aria-hidden="true"
      >✓</span>
      <ChevronRightIcon
        v-else
        class="slides-element-color__chevron"
      />
    </button>
    <div
      v-if="open"
      class="slides-element-color__editor"
      @keydown.esc.stop.prevent="close"
    >
      <div
        class="slides-element-color__plane"
        :style="planeStyle"
        role="group"
        :aria-label="message('slides.elementProperties.colorPlane')"
        @pointerdown.prevent="beginPlane"
        @pointermove="movePlane"
        @pointerup="endPlane"
        @pointercancel="endPlane"
      >
        <span class="slides-element-color__marker" />
      </div>
      <label class="slides-element-color__slider">
        <span>{{ message('slides.elementProperties.hue') }}</span>
        <CustomSlider
          variant="compact"
          :min="0"
          :max="359"
          :model-value="hsv.hue"
          :disabled="disabled"
          @update:model-value="setChannel('hue', $event)"
        />
      </label>
      <label class="slides-element-color__slider">
        <span>{{ message('slides.elementProperties.saturation') }}</span>
        <CustomSlider
          variant="compact"
          :min="0"
          :max="100"
          :model-value="hsv.saturation * 100"
          :disabled="disabled"
          @update:model-value="setChannel('saturation', $event)"
        />
      </label>
      <label class="slides-element-color__slider">
        <span>{{ message('slides.elementProperties.brightness') }}</span>
        <CustomSlider
          variant="compact"
          :min="0"
          :max="100"
          :model-value="hsv.brightness * 100"
          :disabled="disabled"
          @update:model-value="setChannel('brightness', $event)"
        />
      </label>
      <div class="slides-element-color__hex">
        <span
          class="slides-element-color__swatch"
          :style="{ '--slides-custom-color': draftColor }"
        />
        <CustomTextInput
          ref="hexInput"
          :model-value="hexDraft"
          size="compact"
          :disabled="disabled"
          :aria-label="message('slides.elementProperties.hex')"
          :aria-invalid="!validHex"
          @update:model-value="setHex"
          @keydown.enter.prevent="apply"
        />
      </div>
      <span
        v-if="!validHex"
        class="slides-element-color__error"
        role="status"
      >{{ message('slides.elementProperties.invalidHex') }}</span>
      <ActionButtons
        :primary-action-text="message('slides.elementProperties.applyColor')"
        :secondary-action-text="message('slides.elementProperties.cancel')"
        :is-primary-action-disabled="disabled || !validHex"
        @primary-click="apply"
        @secondary-click="close"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { ActionButtons, ColorPickerPanel, CustomSlider, CustomTextInput } from '@linnya/renderer-ui';
import { ChevronRightIcon } from '@linnya/renderer-ui/icons';
import { ELEMENT_PROPERTY_COLOR_OPTIONS } from '../definitions/elementPropertyPalette';
import type { CustomColorHsv } from '../definitions/customColor';
import { colorPlaneValue, colorToHsv, hsvToColor, normalizeCustomColor } from '../functions/customColor';
import { useElementPropertyLocalization } from './useElementPropertyLocalization';

const props = defineProps<{
  color: string | null;
  kind: 'text' | 'fill';
  label: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ select: [color: string] }>();
const { elementPropertyMessage: message } = useElementPropertyLocalization();
const trigger = ref<HTMLButtonElement | null>(null);
const open = ref(false);
const hexInput = ref<InstanceType<typeof CustomTextInput> | null>(null);
const hsv = ref<CustomColorHsv>(colorToHsv('#000000'));
const hexDraft = ref('#000000');
const validHex = computed(() => normalizeCustomColor(hexDraft.value));
const draftColor = computed(() => hsvToColor(hsv.value));
const isCustom = computed(() => props.color !== null && !ELEMENT_PROPERTY_COLOR_OPTIONS.some(
  option => option.value.toUpperCase() === props.color?.toUpperCase(),
));
const planeStyle = computed(() => ({
  '--slides-color-hue': hsvToColor({ hue: hsv.value.hue, saturation: 1, brightness: 1 }),
  '--slides-color-saturation': `${hsv.value.saturation * 100}%`,
  '--slides-color-darkness': `${(1 - hsv.value.brightness) * 100}%`,
}));
let planePointer: number | null = null;

function close(): void {
  open.value = false;
  planePointer = null;
  trigger.value?.focus();
}
async function toggle(): Promise<void> {
  if (open.value) return close();
  hexDraft.value = props.color ?? '#000000';
  hsv.value = colorToHsv(hexDraft.value);
  open.value = true;
  await nextTick();
  hexInput.value?.focus();
}
function selectPreset(color: string): void {
  open.value = false;
  emit('select', color);
}
function apply(): void {
  if (props.disabled || !validHex.value) return;
  // 先结束内部草稿，再让父浮层关闭并归还自己的触发点焦点。
  close();
  emit('select', validHex.value);
}
function setHex(value: string): void {
  hexDraft.value = value;
  const valid = normalizeCustomColor(value);
  if (valid) hsv.value = colorToHsv(valid);
}
function setChannel(channel: keyof CustomColorHsv, value: number): void {
  hsv.value = { ...hsv.value, [channel]: value / (channel === 'hue' ? 1 : 100) };
  hexDraft.value = draftColor.value;
}
function beginPlane(event: PointerEvent): void {
  if (props.disabled || event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return;
  planePointer = event.pointerId;
  event.currentTarget.setPointerCapture(event.pointerId);
  movePlane(event);
}
function movePlane(event: PointerEvent): void {
  if (planePointer !== event.pointerId || !(event.currentTarget instanceof HTMLElement)) return;
  const rect = event.currentTarget.getBoundingClientRect();
  hsv.value = { ...hsv.value, ...colorPlaneValue(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height) };
  hexDraft.value = draftColor.value;
}
function endPlane(event: PointerEvent): void {
  if (planePointer !== event.pointerId) return;
  planePointer = null;
  if (event.currentTarget instanceof HTMLElement && event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}
</script>
