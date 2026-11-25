import type { MonthCalendarCell, MonthCalendarInput } from '../definitions/monthCalendar';

const MONTH_CALENDAR_SLOT_COUNT = 42;

/** 固定 6 周、周一开头，换月时高度不变。 */
export function createMonthCalendarCells(input: MonthCalendarInput): readonly MonthCalendarCell[] {
  const year = input.displayDate.getFullYear();
  const month = input.displayDate.getMonth();
  const leadingDays = (new Date(year, month, 1).getDay() + 6) % 7;
  const todayKey = formatDateKey(input.today);
  const selectedKey = input.selectedDate ? formatDateKey(input.selectedDate) : null;
  const minKey = input.minDate ? formatDateKey(input.minDate) : null;

  return Array.from({ length: MONTH_CALENDAR_SLOT_COUNT }, (_, index) => {
    const date = new Date(year, month, index - leadingDays + 1);
    const key = formatDateKey(date);
    const isCurrentMonth = date.getMonth() === month;
    return {
      date,
      key,
      isCurrentMonth,
      isToday: key === todayKey,
      isSelected: key === selectedKey,
      isMarked: isCurrentMonth && (input.isMarked?.(date) ?? false),
      isBeforeMin: minKey !== null && key < minKey,
    };
  });
}

/** 本地日期的 YYYY-MM-DD；字符串顺序就是日期顺序。 */
export function formatDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${`${date.getFullYear()}`.padStart(4, '0')}-${month}-${day}`;
}
