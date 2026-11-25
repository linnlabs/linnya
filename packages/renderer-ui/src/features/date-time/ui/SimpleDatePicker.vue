<template>
  <div
    ref="rootRef"
    class="sdp-root"
  >
    <button
      ref="triggerRef"
      type="button"
      class="sdp-input"
      :class="classNames?.trigger"
      :aria-label="displayValue"
      :aria-expanded="isOpen"
      aria-haspopup="dialog"
      :data-linnya-tooltip="displayValue"
      @click="toggle"
    >
      <CalendarIcon />
    </button>

    <Teleport to="body">
      <DropdownPanel
        ref="panelRef"
        class="sdp-panel"
        :show="isOpen"
        :direction="direction"
        :style="panelStyle"
        @keydown.tab="keepFocusInPanel"
      >
        <MonthCalendar
          ref="calendarRef"
          :model-value="modelValue"
          @update:model-value="handleSelectDate"
        />
      </DropdownPanel>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { CalendarIcon } from '../../../icons';
import { useSharedComponentLocalization } from '../../../localization';
import { useHoverTooltipService } from '../../feedback';
import { DropdownPanel } from '../../select-menu';
import { usePickerPanel } from '../composables/usePickerPanel';
import type { SimpleDatePickerProps } from '../definitions/simpleDatePicker';
import { formatDateKey } from '../functions/createMonthCalendarCells';
import { replaceDatePart } from '../functions/replaceDatePart';
import MonthCalendar from './MonthCalendar.vue';

const props = defineProps<SimpleDatePickerProps>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: Date | null): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const panelRef = ref<InstanceType<typeof DropdownPanel> | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const calendarRef = ref<InstanceType<typeof MonthCalendar> | null>(null);
const { sharedComponentMessage } = useSharedComponentLocalization();
useHoverTooltipService();
const { isOpen, direction, panelStyle, open, close } = usePickerPanel({
  anchorRef: rootRef,
  panelRef,
  align: 'end',
  onEscape: () => triggerRef.value?.focus(),
});

const displayValue = computed(() => props.modelValue
  ? formatDateKey(props.modelValue)
  : props.placeholder || sharedComponentMessage('shared.simpleDatePicker.placeholder'));

function handleSelectDate(date: Date): void {
  // 只替换年月日，保留原来的时间。
  emit('update:modelValue', replaceDatePart(props.modelValue ?? new Date(), date));
  close();
  triggerRef.value?.focus();
}

async function toggle(): Promise<void> {
  if (isOpen.value) {
    close();
    return;
  }
  await open();
  calendarRef.value?.focus();
}

/** 面板在 body 末尾，Tab 在面板里循环，不会掉到页面最后。 */
function keepFocusInPanel(event: KeyboardEvent): void {
  const stops = Array.from(panelRef.value?.element?.querySelectorAll<HTMLButtonElement>('button:not(:disabled, [tabindex="-1"])') ?? []);
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (document.activeElement !== (event.shiftKey ? first : last)) return;
  event.preventDefault();
  (event.shiftKey ? last : first)?.focus();
}
</script>
