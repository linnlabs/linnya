import { describe, expect, it } from 'vitest';
import { createDatePickerCalendarCells } from '../src/features/date-time/functions/createDatePickerCalendarCells';
import {
  createPaddedTimeOptions,
  createTimePickerMinuteValues,
  TIME_PICKER_HOUR_VALUES,
  TIME_PICKER_MINUTE_VALUES,
} from '../src/features/date-time/functions/createPaddedTimeOptions';
import { replaceDatePart } from '../src/features/date-time/functions/replaceDatePart';
import { replaceTimePart } from '../src/features/date-time/functions/replaceTimePart';
import { resolveDatePickerPanelPlacement } from '../src/features/date-time/functions/resolveDatePickerPanelPlacement';

describe('Date/Time 纯交互规则', () => {
  it('始终生成从周一开始的 42 格月历，并标记当前日期与选中日期', () => {
    const cells = createDatePickerCalendarCells({
      displayDate: new Date(2026, 8, 1),
      selectedDate: new Date(2026, 8, 15, 9, 30),
      today: new Date(2026, 8, 20, 16, 45),
    });

    expect(cells).toHaveLength(42);
    expect(cells[0]?.date).toEqual(new Date(2026, 7, 31));
    expect(cells[0]?.isCurrentMonth).toBe(false);
    expect(cells.find(cell => cell.isSelected)?.date).toEqual(new Date(2026, 8, 15));
    expect(cells.find(cell => cell.isToday)?.date).toEqual(new Date(2026, 8, 20));
    expect(cells.at(-1)?.date).toEqual(new Date(2026, 9, 11));
  });

  it('替换日期时保留时间，替换时间时保留日期并清零秒和毫秒', () => {
    const base = new Date(2026, 7, 31, 14, 27, 45, 321);
    const changedDate = replaceDatePart(base, new Date(2027, 1, 3));
    const changedTime = replaceTimePart(base, 8, 5);

    expect(changedDate).toEqual(new Date(2027, 1, 3, 14, 27, 45, 321));
    expect(changedTime).toEqual(new Date(2026, 7, 31, 8, 5, 0, 0));
    expect(base).toEqual(new Date(2026, 7, 31, 14, 27, 45, 321));
  });

  it('只有下方空间不足且上方更宽裕时才把日期面板放到顶部', () => {
    expect(resolveDatePickerPanelPlacement({
      boundaryBottom: 500,
      boundaryTop: 0,
      panelGap: 4,
      panelHeight: 220,
      triggerBottom: 480,
      triggerTop: 440,
    })).toBe('top');

    expect(resolveDatePickerPanelPlacement({
      boundaryBottom: 500,
      boundaryTop: 0,
      panelGap: 4,
      panelHeight: 220,
      triggerBottom: 200,
      triggerTop: 160,
    })).toBe('bottom');
  });

  it('小时与五分钟步长选项保持原有范围和两位展示', () => {
    const hours = createPaddedTimeOptions(TIME_PICKER_HOUR_VALUES);
    const minutes = createPaddedTimeOptions(TIME_PICKER_MINUTE_VALUES);

    expect(hours).toHaveLength(24);
    expect(hours[0]).toEqual({ value: 0, text: '00', label: '00' });
    expect(hours.at(-1)).toEqual({ value: 23, text: '23', label: '23' });
    expect(minutes.map(option => option.value)).toEqual([
      0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
    ]);
  });

  it('非五分钟整点只补入当前分钟并按时间顺序排列', () => {
    expect(createTimePickerMinuteValues(27)).toEqual([
      0, 5, 10, 15, 20, 25, 27, 30, 35, 40, 45, 50, 55,
    ]);
    expect(createTimePickerMinuteValues(25)).toEqual(TIME_PICKER_MINUTE_VALUES);
  });
});
