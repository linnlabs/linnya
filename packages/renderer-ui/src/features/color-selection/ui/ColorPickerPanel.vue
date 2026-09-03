<template>
  <div class="shared-color-picker-panel" :class="{ 'shared-color-picker-panel--no-padding': noPadding }">
    <div v-if="showBackground" class="shared-color-picker-panel__section">
      <div class="shared-color-picker-panel__title">{{ backgroundTitle }}</div>
      <div class="shared-color-picker-panel__grid">
        <button
          v-for="color in backgroundColors"
          :key="color.value"
          class="shared-color-picker-panel__cell"
          :class="{ 'is-current': isBackgroundCurrent(color) }"
          :title="resolveColorLabel(color)"
          type="button"
          :style="{
            backgroundColor: `var(${color.cssVar})`,
            '--linnya-ui-color-picker-cell-border-color': `color-mix(in srgb, var(${color.cssVar}) 85%, black)`,
          }"
          @click="emit('select-background', color)"
        />
      </div>
    </div>

    <div v-if="showText" class="shared-color-picker-panel__section">
      <div class="shared-color-picker-panel__title">{{ textTitle }}</div>
      <div class="shared-color-picker-panel__grid">
        <button
          v-for="color in textColors"
          :key="color.value"
          class="shared-color-picker-panel__cell shared-color-picker-panel__cell--text"
          :class="{ 'is-current': isTextCurrent(color) }"
          :title="resolveColorLabel(color)"
          type="button"
          :style="{
            '--linnya-ui-color-picker-cell-border-color': `color-mix(in srgb, var(${color.cssVar}) 40%, white)`,
          }"
          @click="emit('select-text', color)"
        >
          <span class="shared-color-picker-panel__sample" :style="{ color: `var(${color.cssVar})` }">A</span>
        </button>
      </div>
    </div>

    <div v-if="showClearButton" class="shared-color-picker-panel__footer">
      <ActionButtons
        :show-primary-action="false"
        :secondary-action-text="clearButtonText"
        @secondary-click="emit('clear')"
      />
    </div>
  </div>
</template>

<script setup lang="ts" generic="LabelKey extends string = string">
import { computed } from 'vue';
import { ActionButtons } from '../../actions';
import { useSharedComponentLocalization } from '../../../localization';
import type {
  ColorPickerOption,
  ColorPickerPanelProps,
} from '../definitions/colorPicker';
import { isColorPickerOptionCurrent } from '../functions/colorPickerSelection';

const props = withDefaults(defineProps<ColorPickerPanelProps<LabelKey>>(), {
  backgroundColors: () => [],
  textColors: () => [],
  currentBackgroundValue: null,
  currentTextValue: null,
  showBackground: true,
  showText: true,
  showClearButton: true,
  noPadding: false,
  compareMode: 'by-value',
});

const emit = defineEmits<{
  (event: 'select-background', color: ColorPickerOption<LabelKey>): void;
  (event: 'select-text', color: ColorPickerOption<LabelKey>): void;
  (event: 'clear'): void;
}>();

const { sharedComponentMessage } = useSharedComponentLocalization();

const clearButtonText = computed(() =>
  props.clearButtonText || sharedComponentMessage('shared.colorPicker.clear')
);
const backgroundTitle = computed(() =>
  props.backgroundTitle || sharedComponentMessage('shared.colorPicker.backgroundTitle')
);
const textTitle = computed(() =>
  props.textTitle || sharedComponentMessage('shared.colorPicker.textTitle')
);

function resolveColorLabel(color: ColorPickerOption<LabelKey>): string {
  return props.labelResolver?.(color.labelKey) ?? color.label;
}

function readDocumentCssVariable(cssVariable: string): string {
  return window.getComputedStyle(document.documentElement).getPropertyValue(cssVariable);
}

function isCurrent(
  currentValue: string | null | undefined,
  color: ColorPickerOption<LabelKey>,
): boolean {
  return isColorPickerOptionCurrent(
    currentValue,
    color,
    props.compareMode,
    readDocumentCssVariable,
  );
}

const isBackgroundCurrent = computed(() => (color: ColorPickerOption<LabelKey>) => {
  return isCurrent(props.currentBackgroundValue, color);
});

const isTextCurrent = computed(() => (color: ColorPickerOption<LabelKey>) => {
  return isCurrent(props.currentTextValue, color);
});
</script>
