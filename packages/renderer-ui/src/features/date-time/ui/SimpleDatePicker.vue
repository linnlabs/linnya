<template>
  <div class="sdp-root" ref="rootRef">
    <!-- Trigger -->
    <button
      type="button"
      class="sdp-input"
      :class="classNames?.trigger"
      :aria-label="displayValue"
      :title="displayValue"
      @click="toggleOpen"
    >
      <CalendarIcon />
    </button>

    <!-- Calendar panel -->
    <transition name="sdp-fade">
      <div
        v-if="isOpen"
        ref="panelRef"
        class="sdp-panel"
        :class="`is-placement-${panelPlacement}`"
      >
      <div class="sdp-header">
        <button
          type="button"
          class="sdp-nav-btn"
          @click="goPrev"
        >
          ‹
        </button>

        <div class="sdp-month-label">
          <span
            class="sdp-year-text"
            @click.stop="switchToMonthYear"
          >
            {{ sharedComponentMessage('shared.simpleDatePicker.year', { year: currentYear }) }}
          </span>
          <span v-if="viewMode === 'date'">
            {{ monthNames[currentMonth] }}
          </span>
        </div>

        <button
          type="button"
          class="sdp-nav-btn"
          @click="goNext"
        >
          ›
        </button>
      </div>

      <!-- Date grid view -->
      <template v-if="viewMode === 'date'">
        <div class="sdp-weekdays">
          <span
            v-for="(w, idx) in weekdayNames"
            :key="idx"
            class="sdp-weekday"
          >
            {{ w }}
          </span>
        </div>

        <div class="sdp-grid">
          <button
            v-for="(cell, idx) in calendarCells"
            :key="idx"
            type="button"
            class="sdp-cell"
            :class="{
              'is-empty': !cell.date,
              'is-today': cell.isToday,
              'is-selected': cell.isSelected,
              'is-outside-month': cell.date && !cell.isCurrentMonth,
            }"
            :disabled="!cell.date || !cell.isCurrentMonth"
            @click="cell.date && cell.isCurrentMonth && handleSelectDate(cell.date)"
          >
            <span v-if="cell.date">
              {{ cell.date.getDate() }}
            </span>
          </button>
        </div>
      </template>

      <!-- Month/year selection view -->
      <template v-else>
        <div class="sdp-month-grid">
          <button
            v-for="(name, index) in monthNames"
            :key="index"
            type="button"
            class="sdp-month-item"
            :class="{ 'is-current-month': index === currentMonth }"
            @click.stop="selectMonth(index)"
          >
            {{ name }}
          </button>
        </div>
      </template>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CalendarIcon } from '../../../icons';
import { useSharedComponentLocalization } from '../../../localization';
import type {
  DatePickerCalendarCell,
  DatePickerPanelPlacement,
  DatePickerViewMode,
  SimpleDatePickerProps,
} from '../definitions/simpleDatePicker';
import { createDatePickerCalendarCells } from '../functions/createDatePickerCalendarCells';
import { replaceDatePart } from '../functions/replaceDatePart';
import { resolveDatePickerPanelPlacement } from '../functions/resolveDatePickerPanelPlacement';

const props = defineProps<SimpleDatePickerProps>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: Date | null): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const viewMode = ref<DatePickerViewMode>('date');
const panelPlacement = ref<DatePickerPanelPlacement>('bottom');
const { sharedComponentMessage } = useSharedComponentLocalization();
const PANEL_GAP = 4;
// 打开动画首帧发生在面板真实 DOM 可测量之前；用稳定估值先选方向，避免先按 bottom 动画再跳到 top。
const DATE_PANEL_ESTIMATED_HEIGHT = 220;

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

// 当前展示的月份（用月份第一天表示）
const displayDate = ref<Date>(props.modelValue ?? new Date());

watch(
  () => props.modelValue,
  newVal => {
    if (newVal) {
      // 绑定值变化时，同步展示月份
      displayDate.value = new Date(newVal);
    }
  },
);

const currentYear = computed(() => displayDate.value.getFullYear());
const currentMonth = computed(() => displayDate.value.getMonth());

const displayValue = computed(() => {
  const value = props.modelValue ?? null;
  if (!value) return props.placeholder || sharedComponentMessage('shared.simpleDatePicker.placeholder');
  const y = value.getFullYear();
  const m = (value.getMonth() + 1).toString().padStart(2, '0');
  const d = value.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
});

const today = new Date();

const calendarCells = computed<readonly DatePickerCalendarCell[]>(() =>
  createDatePickerCalendarCells({
    displayDate: displayDate.value,
    selectedDate: props.modelValue,
    today,
  })
);

function goPrev() {
  const year = currentYear.value;
  const month = currentMonth.value;
  if (viewMode.value === 'date') {
    displayDate.value = new Date(year, month - 1, 1);
  } else {
    displayDate.value = new Date(year - 1, month, 1);
  }
}

function goNext() {
  const year = currentYear.value;
  const month = currentMonth.value;
  if (viewMode.value === 'date') {
    displayDate.value = new Date(year, month + 1, 1);
  } else {
    displayDate.value = new Date(year + 1, month, 1);
  }
}

function switchToMonthYear() {
  viewMode.value = 'monthYear';
  void nextTick(updatePanelPlacement);
}

function selectMonth(monthIndex: number) {
  const year = currentYear.value;
  displayDate.value = new Date(year, monthIndex, 1);
  viewMode.value = 'date';
  void nextTick(updatePanelPlacement);
}

function handleSelectDate(date: Date) {
  const base = props.modelValue ?? new Date();
  // 保留原来的小时和分钟（如果有）
  emit('update:modelValue', replaceDatePart(base, date));
  isOpen.value = false;
}

function toggleOpen() {
  if (isOpen.value) {
    isOpen.value = false;
    return;
  }
  viewMode.value = 'date';
  panelPlacement.value = resolvePanelPlacement(DATE_PANEL_ESTIMATED_HEIGHT);
  isOpen.value = true;
  void nextTick(updatePanelPlacement);
}

function updatePanelPlacement(): void {
  const root = rootRef.value;
  const panel = panelRef.value;
  if (!root || !panel) return;

  const rootRect = root.getBoundingClientRect();
  const panelHeight = panel.getBoundingClientRect().height;
  panelPlacement.value = resolvePanelPlacement(panelHeight);
}

function resolvePanelPlacement(panelHeight: number): DatePickerPanelPlacement {
  const root = rootRef.value;
  if (!root) return 'bottom';

  const rootRect = root.getBoundingClientRect();
  const boundary = resolveVisibleBoundary(root);
  return resolveDatePickerPanelPlacement({
    boundaryBottom: boundary.bottom,
    boundaryTop: boundary.top,
    panelGap: PANEL_GAP,
    panelHeight,
    triggerBottom: rootRect.bottom,
    triggerTop: rootRect.top,
  });
}

function resolveVisibleBoundary(root: HTMLElement): { readonly top: number; readonly bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  let element = root.parentElement;

  while (element) {
    const style = window.getComputedStyle(element);
    if (clipsVerticalOverflow(style)) {
      const rect = element.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    element = element.parentElement;
  }

  return { top, bottom };
}

function clipsVerticalOverflow(style: CSSStyleDeclaration): boolean {
  return style.overflowY === 'auto' ||
    style.overflowY === 'scroll' ||
    style.overflowY === 'hidden' ||
    style.overflowY === 'clip';
}

function handleViewportChange(): void {
  if (!isOpen.value) return;
  void nextTick(updatePanelPlacement);
}

function handleClickOutside(e: MouseEvent) {
  if (!rootRef.value) return;
  const target = e.target instanceof Node ? e.target : null;
  if (target && !rootRef.value.contains(target)) {
    isOpen.value = false;
  }
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !isOpen.value) return;
  event.preventDefault();
  isOpen.value = false;
}

onMounted(() => {
  window.addEventListener('click', handleClickOutside);
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('scroll', handleViewportChange, true);
  document.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('click', handleClickOutside);
  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('scroll', handleViewportChange, true);
  document.removeEventListener('keydown', handleKeyDown);
});
</script>
