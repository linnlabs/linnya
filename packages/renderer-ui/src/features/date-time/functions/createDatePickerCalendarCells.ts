import type {
  DatePickerCalendarCell,
  DatePickerCalendarInput,
} from '../definitions/simpleDatePicker';

const DATE_PICKER_CALENDAR_SLOT_COUNT = 42;

export function createDatePickerCalendarCells(
  input: DatePickerCalendarInput,
): readonly DatePickerCalendarCell[] {
  const year = input.displayDate.getFullYear();
  const month = input.displayDate.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay() || 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: DatePickerCalendarCell[] = [];

  for (let index = 1; index < firstWeekday; index += 1) {
    const offset = firstWeekday - index;
    cells.push(createCalendarCell(new Date(year, month, 1 - offset), false, input));
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(createCalendarCell(new Date(year, month, day), true, input));
  }

  const remaining = DATE_PICKER_CALENDAR_SLOT_COUNT - cells.length;
  for (let day = 1; day <= remaining; day += 1) {
    cells.push(createCalendarCell(new Date(year, month + 1, day), false, input));
  }

  return cells;
}

function createCalendarCell(
  date: Date,
  isCurrentMonth: boolean,
  input: DatePickerCalendarInput,
): DatePickerCalendarCell {
  return {
    date,
    isToday: isSameCalendarDate(date, input.today),
    isSelected: input.selectedDate !== null && isSameCalendarDate(date, input.selectedDate),
    isCurrentMonth,
  };
}

function isSameCalendarDate(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}
