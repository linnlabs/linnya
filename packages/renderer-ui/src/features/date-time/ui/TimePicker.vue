<template>
  <div
    ref="rootRef"
    class="linnya-time-picker"
  >
    <CustomTextInput
      ref="inputRef"
      control-class="linnya-time-picker__input"
      role="combobox"
      autocomplete="off"
      :model-value="text"
      :placeholder="placeholderText"
      :aria-label="ariaLabel || placeholderText"
      :aria-expanded="isOpen"
      :aria-controls="isOpen ? listId : undefined"
      :aria-activedescendant="isOpen && activeIndex !== null ? optionId(activeIndex) : undefined"
      aria-haspopup="listbox"
      aria-autocomplete="none"
      @update:model-value="handleInput"
      @click="openList"
      @keydown="handleKeydown"
      @blur="finishEditing"
    />

    <Teleport to="body">
      <DropdownPanel
        ref="panelRef"
        class="linnya-time-picker__panel"
        :show="isOpen"
        :direction="direction"
        :style="panelStyle"
        @mousedown.prevent
      >
        <div
          :id="listId"
          role="listbox"
          :aria-label="ariaLabel || placeholderText"
        >
          <div
            v-for="(option, index) in TIME_PICKER_OPTIONS"
            :id="optionId(index)"
            :key="index"
            class="linnya-time-picker__option"
            :class="{ 'is-selected': index === selectedIndex, 'is-active': index === activeIndex }"
            role="option"
            :aria-selected="index === selectedIndex"
            @click="selectOption(option)"
          >{{ formatTimeOfDay(option) }}</div>
        </div>
      </DropdownPanel>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useSharedComponentLocalization } from '../../../localization';
import { DropdownPanel } from '../../select-menu';
import { CustomTextInput } from '../../text-entry';
import { usePickerPanel } from '../composables/usePickerPanel';
import type { TimeOfDay, TimePickerProps } from '../definitions/timePicker';
import { replaceTimePart } from '../functions/replaceTimePart';
import {
  formatTimeOfDay,
  nearestTimeOptionIndex,
  parseTimeText,
  TIME_PICKER_OPTIONS,
} from '../functions/timeText';

const props = defineProps<TimePickerProps>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: Date | null): void;
}>();

const { sharedComponentMessage } = useSharedComponentLocalization();
const rootRef = ref<HTMLElement | null>(null);
const panelRef = ref<InstanceType<typeof DropdownPanel> | null>(null);
const inputRef = ref<InstanceType<typeof CustomTextInput> | null>(null);
const listId = useId();
const text = ref(currentText());
const activeIndex = ref<number | null>(null);
const { isOpen, direction, panelStyle, open, close } = usePickerPanel({
  anchorRef: rootRef,
  panelRef,
  align: 'start',
  onEscape: revertText,
});

const placeholderText = computed(() =>
  props.placeholder || sharedComponentMessage('shared.timePicker.placeholder')
);
const selectedIndex = computed(() => {
  const label = currentText();
  return TIME_PICKER_OPTIONS.findIndex(option => formatTimeOfDay(option) === label);
});

watch(() => props.modelValue, revertText);

function currentTime(): TimeOfDay | null {
  return props.modelValue
    ? { hour: props.modelValue.getHours(), minute: props.modelValue.getMinutes() }
    : null;
}

function currentText(): string {
  const time = currentTime();
  return time ? formatTimeOfDay(time) : '';
}

function revertText(): void {
  text.value = currentText();
}

function optionId(index: number): string {
  return `${listId}-${index}`;
}

function handleInput(value: string): void {
  text.value = value;
  activeIndex.value = null;
}

async function openList(): Promise<void> {
  if (isOpen.value) return;
  activeIndex.value = null;
  inputRef.value?.select();
  await open();
  const now = new Date();
  revealOption(nearestTimeOptionIndex(currentTime() ?? { hour: now.getHours(), minute: now.getMinutes() }));
}

/** 只滚动列表自己，不带动外层的弹窗或页面。 */
function revealOption(index: number): void {
  const panel = panelRef.value?.element;
  const option = panel?.querySelectorAll<HTMLElement>('[role="option"]')[index];
  if (panel && option) panel.scrollTop = option.offsetTop - (panel.clientHeight - option.offsetHeight) / 2;
}

function commitTime(time: TimeOfDay): void {
  const current = currentTime();
  if (current && current.hour === time.hour && current.minute === time.minute) {
    revertText();
    return;
  }
  text.value = formatTimeOfDay(time);
  emit('update:modelValue', replaceTimePart(props.modelValue ?? new Date(), time.hour, time.minute));
}

/** 认不出的输入退回原来的时间，不提交。 */
function commitText(): void {
  const time = parseTimeText(text.value);
  if (time) commitTime(time);
  else revertText();
}

function selectOption(option: TimeOfDay): void {
  commitTime(option);
  close();
}

function finishEditing(): void {
  commitText();
  close();
}

function moveActive(offset: 1 | -1): void {
  const time = parseTimeText(text.value) ?? currentTime() ?? { hour: 9, minute: 0 };
  const start = activeIndex.value ?? nearestTimeOptionIndex(time);
  const next = Math.min(TIME_PICKER_OPTIONS.length - 1, Math.max(0, start + offset));
  activeIndex.value = next;
  void nextTick(() => revealOption(next));
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    const option = isOpen.value && activeIndex.value !== null ? TIME_PICKER_OPTIONS[activeIndex.value] : undefined;
    if (option) commitTime(option);
    else commitText();
    close();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  if (isOpen.value) moveActive(event.key === 'ArrowDown' ? 1 : -1);
  else void openList();
}
</script>
