<template>
  <div class="time-root" ref="rootRef">
    <button
      type="button"
      class="time-button"
      @click="toggleTimePopover"
    >
      {{ displayTime || placeholderText }}
    </button>

    <transition name="time-fade">
      <div
        v-if="isTimePopoverOpen"
        class="time-popover"
      >
      <div class="time-popover-body">
        <div class="time-select-row">
          <div class="time-select-wrapper">
            <CustomSelect
              :model-value="timeHour"
              :options="hourOptions"
              min-width="45px"
              font-size="12px"
              variant="minimal"
              :class-names="{ trigger: 'time-select-trigger', options: 'time-select-options' }"
              @update:model-value="timeHour = $event"
            >
              <template #arrow-icon="{ isOpen }">
                <ChevronIcon
                  direction="up"
                  :class="['time-arrow-icon', { 'is-open': isOpen }]"
                /> 
              </template>
            </CustomSelect>
          </div>
          <span class="time-separator">:</span>
          <div class="time-select-wrapper">
            <CustomSelect
              :model-value="timeMinute"
              :options="minuteSelectOptions"
              min-width="45px"
              font-size="12px"
              variant="minimal"
              :class-names="{ trigger: 'time-select-trigger', options: 'time-select-options' }"
              @update:model-value="timeMinute = $event"
            >
              <template #arrow-icon="{ isOpen }">
                <ChevronIcon
                  direction="up"
                  :class="['time-arrow-icon', { 'is-open': isOpen }]"
                />
              </template>
            </CustomSelect>
          </div>
        </div>
      </div>
      <div class="time-popover-actions">
        <button
          type="button"
          class="time-action-button secondary"
          @click="closeTimePopover"
        >
          {{ sharedComponentMessage('shared.timePicker.cancel') }}
        </button>
        <button
          type="button"
          class="time-action-button primary"
          @click="applyTimeSelection"
        >
          {{ sharedComponentMessage('shared.timePicker.confirm') }}
        </button>
      </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronIcon } from '../../../icons';
import { useSharedComponentLocalization } from '../../../localization';
import { CustomSelect } from '../../select-menu';
import type { CustomSelectOption } from '../../select-menu';
import type { TimePickerProps } from '../definitions/timePicker';
import {
  createPaddedTimeOptions,
  createTimePickerMinuteValues,
  TIME_PICKER_HOUR_VALUES,
} from '../functions/createPaddedTimeOptions';
import { replaceTimePart } from '../functions/replaceTimePart';

const props = defineProps<TimePickerProps>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: Date | null): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const isTimePopoverOpen = ref(false);
const timeHour = ref<number>(props.modelValue?.getHours() ?? new Date().getHours());
const timeMinute = ref<number>(props.modelValue?.getMinutes() ?? new Date().getMinutes());
const { sharedComponentMessage } = useSharedComponentLocalization();

const placeholderText = computed(() =>
  props.placeholder || sharedComponentMessage('shared.timePicker.placeholder')
);

// 生成小时选项（0-23）
const hourOptions = computed<readonly CustomSelectOption<number>[]>(() =>
  createPaddedTimeOptions(TIME_PICKER_HOUR_VALUES)
);

// 五分钟步长之外保留当前真实分钟，避免打开面板后静默丢失既有值。
const minuteSelectOptions = computed<readonly CustomSelectOption<number>[]>(() =>
  createPaddedTimeOptions(createTimePickerMinuteValues(timeMinute.value))
);

const displayTime = computed(() => {
  if (!props.modelValue) return '';
  const h = props.modelValue.getHours().toString().padStart(2, '0');
  const m = props.modelValue.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
});

function syncTimeFromValue() {
  const base = props.modelValue ?? new Date();
  timeHour.value = base.getHours();
  timeMinute.value = base.getMinutes();
}

watch(
  () => props.modelValue,
  () => {
    if (isTimePopoverOpen.value) {
      syncTimeFromValue();
    }
  },
);

function toggleTimePopover() {
  if (!isTimePopoverOpen.value) {
    syncTimeFromValue();
  }
  isTimePopoverOpen.value = !isTimePopoverOpen.value;
}

function closeTimePopover() {
  isTimePopoverOpen.value = false;
}

function applyTimeSelection() {
  const base = props.modelValue ?? new Date();
  emit('update:modelValue', replaceTimePart(base, timeHour.value, timeMinute.value));
  isTimePopoverOpen.value = false;
}

function handleClickOutside(e: MouseEvent) {
  if (!rootRef.value) return;
  const target = e.target instanceof Node ? e.target : null;
  if (target && !rootRef.value.contains(target)) {
    isTimePopoverOpen.value = false;
  }
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !isTimePopoverOpen.value) return;
  event.preventDefault();
  closeTimePopover();
}

onMounted(() => {
  window.addEventListener('click', handleClickOutside);
  document.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', handleKeyDown);
});
</script>
