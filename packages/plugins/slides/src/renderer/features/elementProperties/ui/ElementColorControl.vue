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
      :aria-controls="open ? submenuId : undefined"
      :disabled="disabled"
      @mouseenter="show()"
      @mouseleave="scheduleClose"
      @click="show(true)"
      @keydown="handleRowKeydown"
    >
      <span
        class="slides-element-color__swatch slides-element-color__swatch--small"
        :style="{ '--slides-custom-color': color ?? 'transparent' }"
      />
      <span class="slides-element-color__caption">{{ message('slides.elementProperties.customColor') }}</span>
      <span
        v-if="isCustom"
        aria-hidden="true"
      >✓</span>
      <ChevronRightIcon class="slides-element-color__chevron" />
    </button>
    <!-- 留在本实例 BaseDropdown 的 DOM 内，既逃离色板滚动裁剪，也保持外部点击/焦点归属。 -->
    <Teleport
      v-if="overlayHost"
      :to="overlayHost"
    >
      <DropdownPanel
        :id="submenuId"
        ref="submenu"
        :show="open"
        class="slides-element-color__submenu"
        :style="submenuStyle"
        role="group"
        tabindex="-1"
        :aria-label="message('slides.elementProperties.customColor')"
        @mouseenter="keepOpen"
        @mouseleave="scheduleClose"
        @focusout="scheduleClose"
        @pointerdown.stop
        @keydown.stop
        @keydown.esc.stop.prevent="close(true)"
      >
        <div class="slides-element-color__editor">
          <SegmentedTabs
            :model-value="mode"
            :tabs="[{ id: 'hsv', label: 'HSV', disabled }, { id: 'rgb', label: 'RGB', disabled }]"
            :aria-label="message('slides.elementProperties.colorMode')"
            @update:model-value="setMode"
          />
          <template v-if="mode === 'hsv'">
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
            <label
              v-for="channel in hsvChannels"
              :key="channel"
              class="slides-element-color__slider"
            >
              <span>{{ message(`slides.elementProperties.${channel}`) }}</span>
              <CustomSlider
                variant="compact"
                :min="0"
                :max="channel === 'hue' ? 359 : 100"
                :model-value="hsv[channel] * (channel === 'hue' ? 1 : 100)"
                :disabled="disabled"
                @update:model-value="setChannel(channel, $event)"
              />
            </label>
          </template>
          <div
            v-else
            class="slides-element-color__rgb"
          >
            <div
              v-for="channel in rgbChannels"
              :key="channel"
              class="slides-element-color__rgb-channel"
            >
              <span :id="`${submenuId}-${channel}`">{{ message(`slides.elementProperties.${channel}`) }}</span>
              <CustomSlider
                variant="compact"
                :min="0"
                :max="255"
                :model-value="rgb[channel]"
                :disabled="disabled"
                :aria-labelledby="`${submenuId}-${channel}`"
                @update:model-value="setRgbChannel(channel, $event)"
              />
              <CustomNumberInput
                :model-value="rgbDraft[channel]"
                variant="panel"
                :input-width="48"
                :min="0"
                :max="255"
                :step="1"
                :disabled="disabled"
                :aria-labelledby="`${submenuId}-${channel}`"
                :aria-invalid="!isValidRgbChannel(rgbDraft[channel])"
                :data-channel="channel"
                @update:model-value="setRgbChannel(channel, $event)"
                @keydown.enter.prevent="apply"
              />
            </div>
          </div>
          <div class="slides-element-color__hex">
            <span
              class="slides-element-color__swatch"
              :style="{ '--slides-custom-color': draftColor }"
            />
            <CustomTextInput
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
            v-if="!validColor"
            class="slides-element-color__error"
            role="status"
          >
            {{ message(!validRgb ? 'slides.elementProperties.invalidRgb' : 'slides.elementProperties.invalidHex') }}
          </span>
          <ActionButtons
            class="slides-element-color__actions"
            :primary-action-text="message('slides.elementProperties.applyColor')"
            :secondary-action-text="message('slides.elementProperties.cancel')"
            :is-primary-action-disabled="disabled || !validColor"
            @primary-click="apply"
            @secondary-click="close(true)"
          />
        </div>
      </DropdownPanel>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, useId } from 'vue';
import { ActionButtons, ColorPickerPanel, CustomNumberInput, CustomSlider, CustomTextInput, DropdownPanel, SegmentedTabs, type FloatingToolbarPosition } from '@linnya/renderer-ui';
import { ChevronRightIcon } from '@linnya/renderer-ui/icons';
import { ELEMENT_PROPERTY_COLOR_OPTIONS } from '../definitions/elementPropertyPalette';
import { colorPlaneValue, isValidRgbChannel } from '../functions/customColor';
import { useCustomColorDraft } from '../orchestration/useCustomColorDraft';
import { useCustomColorSubmenu } from '../orchestration/useCustomColorSubmenu';
import { useElementPropertyLocalization } from './useElementPropertyLocalization';

const props = defineProps<{
  color: string | null;
  kind: 'text' | 'fill';
  label: string;
  disabled?: boolean;
  overlayHost: HTMLElement | null;
  menuElement: HTMLElement | null;
  menuPosition: FloatingToolbarPosition | null;
}>();
const emit = defineEmits<{ select: [color: string] }>();
const { elementPropertyMessage: message } = useElementPropertyLocalization();
const trigger = ref<HTMLButtonElement | null>(null);
const submenu = ref<InstanceType<typeof DropdownPanel> | null>(null);
const submenuId = useId();
const hsvChannels = ['hue', 'saturation', 'brightness'] as const;
const rgbChannels = ['red', 'green', 'blue'] as const;
const { mode, hexDraft, hsv, rgbDraft, rgb, draftColor, validHex, validRgb, validColor, reset, setMode, setHex, setHsv, setChannel, setRgbChannel } = useCustomColorDraft();
const { open, style: submenuStyle, show, close, keepOpen, scheduleClose, handleRowKeydown } = useCustomColorSubmenu({
  trigger, panel: computed(() => submenu.value?.element ?? null),
  overlayHost: toRef(props, 'overlayHost'), menuElement: toRef(props, 'menuElement'), menuPosition: toRef(props, 'menuPosition'),
  disabled: computed(() => props.disabled === true), reset: () => { planePointer = null; reset(props.color ?? '#000000'); },
});
const isCustom = computed(() => props.color !== null
  && !ELEMENT_PROPERTY_COLOR_OPTIONS.some(option => option.value.toUpperCase() === props.color?.toUpperCase()));
const planeStyle = computed(() => ({
  '--slides-color-hue': `hsl(${hsv.value.hue} 100% 50%)`,
  '--slides-color-saturation': `${hsv.value.saturation * 100}%`,
  '--slides-color-darkness': `${(1 - hsv.value.brightness) * 100}%`,
}));
let planePointer: number | null = null;
defineExpose({
  dismissCustom(): boolean {
    if (!open.value) return false;
    close(true);
    return true;
  },
});
function selectPreset(color: string): void { close(); emit('select', color); }
function apply(): void {
  if (props.disabled || !validColor.value) return;
  close();
  emit('select', validColor.value);
}
function beginPlane(event: PointerEvent): void {
  if (props.disabled || event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return;
  // 色平面本身不是输入控件；拖动时显式保留面板，避免鼠标越界后被悬停计时器关闭。
  void show(true);
  planePointer = event.pointerId;
  event.currentTarget.setPointerCapture(event.pointerId);
  movePlane(event);
}
function movePlane(event: PointerEvent): void {
  if (planePointer !== event.pointerId || !(event.currentTarget instanceof HTMLElement)) return;
  const rect = event.currentTarget.getBoundingClientRect();
  setHsv({ ...hsv.value, ...colorPlaneValue(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height) });
}
function endPlane(event: PointerEvent): void {
  if (planePointer !== event.pointerId) return;
  planePointer = null;
  if (event.currentTarget instanceof HTMLElement && event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}
</script>
