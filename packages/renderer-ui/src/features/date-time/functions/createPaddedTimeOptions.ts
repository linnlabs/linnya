import type { CustomSelectOption } from '../../select-menu';

export const TIME_PICKER_HOUR_VALUES: readonly number[] = Array.from(
  { length: 24 },
  (_, index) => index,
);

export const TIME_PICKER_MINUTE_VALUES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;

/**
 * 五分钟步长是新选择的快捷集合，但已有时间必须保持可见且可再次确认。
 * 非五分钟整点只补入当前值，不扩大后续选择范围，也不静默舍入业务数据。
 */
export function createTimePickerMinuteValues(currentMinute: number): readonly number[] {
  if (TIME_PICKER_MINUTE_VALUES.some(value => value === currentMinute)) {
    return TIME_PICKER_MINUTE_VALUES;
  }
  return [...TIME_PICKER_MINUTE_VALUES, currentMinute].sort((left, right) => left - right);
}

export function createPaddedTimeOptions(
  values: readonly number[],
): readonly CustomSelectOption<number>[] {
  return values.map((value) => {
    const label = value.toString().padStart(2, '0');
    return { value, text: label, label };
  });
}
