<template>
  <div
    ref="rootRef"
    class="linnya-month-calendar"
    role="group"
    :aria-label="title"
  >
    <div class="linnya-month-calendar__header">
      <button
        type="button"
        class="linnya-month-calendar__title"
        :aria-expanded="viewMode === 'months'"
        @click="toggleViewMode"
      >
        {{ title }}
      </button>
      <IconButton
        :label="sharedComponentMessage('shared.simpleDatePicker.previous')"
        :tooltip="false"
        @click="stepDisplay(-1)"
      >
        <ChevronIcon direction="left" />
      </IconButton>
      <IconButton
        :label="sharedComponentMessage('shared.simpleDatePicker.next')"
        :tooltip="false"
        @click="stepDisplay(1)"
      >
        <ChevronIcon direction="right" />
      </IconButton>
    </div>

    <div
      v-if="viewMode === 'days'"
      class="linnya-month-calendar__body linnya-month-calendar__days"
      @keydown="handleKeydown"
    >
      <span
        v-for="name in weekdayNames"
        :key="name"
        class="linnya-month-calendar__weekday"
        aria-hidden="true"
      >{{ name }}</span>
      <button
        v-for="cell in cells"
        :key="cell.key"
        type="button"
        class="linnya-month-calendar__cell"
        :class="{
          'is-outside-month': !cell.isCurrentMonth,
          'is-before-min': cell.isBeforeMin,
          'is-today': cell.isToday,
          'is-marked': cell.isMarked,
          'is-selected': cell.isSelected,
        }"
        :data-date="cell.isCurrentMonth ? cell.key : undefined"
        :disabled="!isSelectable(cell)"
        :tabindex="cell.key === focusableKey ? 0 : -1"
        :aria-label="`${title} ${cell.date.getDate()}`"
        :aria-pressed="selectable ? cell.isSelected : undefined"
        :aria-current="cell.isToday ? 'date' : undefined"
        :aria-hidden="cell.isCurrentMonth ? undefined : 'true'"
        @click="emit('update:modelValue', cell.date)"
      >{{ cell.date.getDate() }}</button>
    </div>

    <div
      v-else
      class="linnya-month-calendar__body linnya-month-calendar__months"
    >
      <button
        v-for="(name, index) in monthNames"
        :key="name"
        type="button"
        class="linnya-month-calendar__month"
        :class="{ 'is-current-month': index === displayDate.getMonth() }"
        @click="selectMonth(index)"
      >
        {{ name }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ChevronIcon } from '../../../icons';
import { useSharedComponentLocalization } from '../../../localization';
import IconButton from '../../actions/ui/IconButton.vue';
import type { MonthCalendarCell, MonthCalendarProps, MonthCalendarViewMode } from '../definitions/monthCalendar';
import { createMonthCalendarCells, formatDateKey } from '../functions/createMonthCalendarCells';
import { moveCalendarDate } from '../functions/moveCalendarDate';

const props = withDefaults(defineProps<MonthCalendarProps>(), {
  month: null,
  selectable: true,
  minDate: null,
  isMarked: undefined,
});
const emit = defineEmits<{
  'update:modelValue': [value: Date];
  /** 当前展示的月份（该月第一天）；挂载时也会报告一次。 */
  'update:month': [month: Date];
}>();

const { sharedComponentMessage } = useSharedComponentLocalization();
const rootRef = ref<HTMLElement | null>(null);
const viewMode = ref<MonthCalendarViewMode>('days');
const displayDate = ref(firstOfMonth(props.month ?? props.modelValue ?? new Date()));
const focusedDate = ref<Date | null>(null);

const monthNames = computed(() => [
  sharedComponentMessage('shared.simpleDatePicker.month.1'),
  sharedComponentMessage('shared.simpleDatePicker.month.2'),
  sharedComponentMessage('shared.simpleDatePicker.month.3'),
  sharedComponentMessage('shared.simpleDatePicker.month.4'),
  sharedComponentMessage('shared.simpleDatePicker.month.5'),
  sharedComponentMessage('shared.simpleDatePicker.month.6'),
  sharedComponentMessage('shared.simpleDatePicker.month.7'),
  sharedComponentMessage('shared.simpleDatePicker.month.8'),
  sharedComponentMessage('shared.simpleDatePicker.month.9'),
  sharedComponentMessage('shared.simpleDatePicker.month.10'),
  sharedComponentMessage('shared.simpleDatePicker.month.11'),
  sharedComponentMessage('shared.simpleDatePicker.month.12'),
]);
const weekdayNames = computed(() => [
  sharedComponentMessage('shared.simpleDatePicker.weekday.monday'),
  sharedComponentMessage('shared.simpleDatePicker.weekday.tuesday'),
  sharedComponentMessage('shared.simpleDatePicker.weekday.wednesday'),
  sharedComponentMessage('shared.simpleDatePicker.weekday.thursday'),
  sharedComponentMessage('shared.simpleDatePicker.weekday.friday'),
  sharedComponentMessage('shared.simpleDatePicker.weekday.saturday'),
  sharedComponentMessage('shared.simpleDatePicker.weekday.sunday'),
]);
const title = computed(() => {
  const year = displayDate.value.getFullYear();
  return viewMode.value === 'days'
    ? sharedComponentMessage('shared.simpleDatePicker.yearMonth', { year, month: monthNames.value[displayDate.value.getMonth()] ?? '' })
    : sharedComponentMessage('shared.simpleDatePicker.year', { year });
});

const cells = computed(() => createMonthCalendarCells({
  displayDate: displayDate.value,
  selectedDate: props.modelValue,
  today: new Date(),
  minDate: props.minDate,
  isMarked: props.isMarked,
}));

/** 月历整体只占一个 Tab 位：选中的日子，其次今天，再次本月第一个可选的日子。 */
const focusableKey = computed(() => {
  const available = cells.value.filter(isSelectable);
  const focusedKey = focusedDate.value ? formatDateKey(focusedDate.value) : null;
  return (available.find(cell => cell.key === focusedKey)
    ?? available.find(cell => cell.isSelected)
    ?? available.find(cell => cell.isToday)
    ?? available[0])?.key ?? null;
});

// 没有选中日期时回到今天所在的月份。
watch(() => (props.modelValue ? formatDateKey(props.modelValue) : null), () => {
  displayDate.value = firstOfMonth(props.modelValue ?? new Date());
  focusedDate.value = null;
});
watch(() => (props.month ? formatDateKey(firstOfMonth(props.month)) : null), (key) => {
  if (props.month && key !== formatDateKey(displayDate.value)) displayDate.value = firstOfMonth(props.month);
});
watch(() => formatDateKey(displayDate.value), () => emit('update:month', displayDate.value), { immediate: true });

function firstOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSelectable(cell: MonthCalendarCell): boolean {
  return props.selectable && cell.isCurrentMonth && !cell.isBeforeMin;
}

function stepDisplay(offset: 1 | -1): void {
  const current = displayDate.value;
  displayDate.value = viewMode.value === 'days'
    ? new Date(current.getFullYear(), current.getMonth() + offset, 1)
    : new Date(current.getFullYear() + offset, current.getMonth(), 1);
}

function toggleViewMode(): void {
  viewMode.value = viewMode.value === 'days' ? 'months' : 'days';
}

function selectMonth(month: number): void {
  displayDate.value = new Date(displayDate.value.getFullYear(), month, 1);
  viewMode.value = 'days';
}

function handleKeydown(event: KeyboardEvent): void {
  const current = cells.value.find(cell => cell.key === focusableKey.value);
  const moved = current ? moveCalendarDate(current.date, event.key) : null;
  if (!moved) return;
  event.preventDefault();
  const target = props.minDate && formatDateKey(moved) < formatDateKey(props.minDate) ? props.minDate : moved;
  focusedDate.value = target;
  displayDate.value = firstOfMonth(target);
  void nextTick(focusCell);
}

function focusCell(): void {
  rootRef.value?.querySelector<HTMLButtonElement>('.linnya-month-calendar__cell[tabindex="0"]')?.focus();
}

defineExpose({ focus: focusCell });
</script>
