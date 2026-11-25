import { describe, expect, it } from 'vitest';
import { createMonthCalendarCells, formatDateKey } from '../src/features/date-time/functions/createMonthCalendarCells';
import { moveCalendarDate } from '../src/features/date-time/functions/moveCalendarDate';
import { replaceDatePart } from '../src/features/date-time/functions/replaceDatePart';
import { replaceTimePart } from '../src/features/date-time/functions/replaceTimePart';
import {
  formatTimeOfDay,
  nearestTimeOptionIndex,
  parseTimeText,
  TIME_PICKER_OPTIONS,
} from '../src/features/date-time/functions/timeText';

describe('月历', () => {
  it('始终生成从周一开始的 42 格，标记今天与选中日期', () => {
    const cells = createMonthCalendarCells({
      displayDate: new Date(2026, 8, 1),
      selectedDate: new Date(2026, 8, 15, 9, 30),
      today: new Date(2026, 8, 20, 16, 45),
    });

    expect(cells).toHaveLength(42);
    expect(cells[0]?.key).toBe('2026-08-31');
    expect(cells[0]?.isCurrentMonth).toBe(false);
    expect(cells.find(cell => cell.isSelected)?.date).toEqual(new Date(2026, 8, 15));
    expect(cells.find(cell => cell.isToday)?.date).toEqual(new Date(2026, 8, 20));
    expect(cells.at(-1)?.key).toBe('2026-10-11');
  });

  it('周日开头的月份也从周一排起', () => {
    const cells = createMonthCalendarCells({
      displayDate: new Date(2026, 10, 1),
      selectedDate: null,
      today: new Date(2026, 10, 25),
    });

    expect(cells[0]?.key).toBe('2026-10-26');
    expect(cells[6]?.key).toBe('2026-11-01');
    expect(cells.some(cell => cell.isSelected)).toBe(false);
  });

  it('最早日期只比较年月日；标注只落在当前月份', () => {
    const cells = createMonthCalendarCells({
      displayDate: new Date(2026, 8, 1),
      selectedDate: null,
      today: new Date(2026, 8, 10),
      minDate: new Date(2026, 8, 10, 23, 59),
      isMarked: date => date.getDay() === 1,
    });
    const byKey = (key: string) => cells.find(cell => cell.key === key);

    expect(byKey('2026-09-09')?.isBeforeMin).toBe(true);
    expect(byKey('2026-09-10')?.isBeforeMin).toBe(false);
    expect(cells.filter(cell => cell.isMarked).map(cell => cell.key)).toEqual([
      '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28',
    ]);
  });

  it('方向键按天与周移动，Home / End 到本周首尾，翻月不溢出', () => {
    const date = new Date(2026, 9, 31);
    const move = (key: string) => {
      const moved = moveCalendarDate(date, key);
      return moved ? formatDateKey(moved) : null;
    };

    expect(move('ArrowLeft')).toBe('2026-10-30');
    expect(move('ArrowRight')).toBe('2026-11-01');
    expect(move('ArrowUp')).toBe('2026-10-24');
    expect(move('ArrowDown')).toBe('2026-11-07');
    expect(move('Home')).toBe('2026-10-26');
    expect(move('End')).toBe('2026-11-01');
    expect(move('PageDown')).toBe('2026-11-30');
    expect(move('PageUp')).toBe('2026-09-30');
    expect(move('Enter')).toBeNull();
  });
});

describe('日期与时间的值', () => {
  it('替换日期时保留时间，替换时间时保留日期并清零秒和毫秒', () => {
    const base = new Date(2026, 7, 31, 14, 27, 45, 321);

    expect(replaceDatePart(base, new Date(2027, 1, 3))).toEqual(new Date(2027, 1, 3, 14, 27, 45, 321));
    expect(replaceTimePart(base, 8, 5)).toEqual(new Date(2026, 7, 31, 8, 5, 0, 0));
    expect(base).toEqual(new Date(2026, 7, 31, 14, 27, 45, 321));
  });

  it('认得常见的时间写法，认不出或超出一天时不给值', () => {
    expect(parseTimeText('9')).toEqual({ hour: 9, minute: 0 });
    expect(parseTimeText('930')).toEqual({ hour: 9, minute: 30 });
    expect(parseTimeText('0930')).toEqual({ hour: 9, minute: 30 });
    expect(parseTimeText(' 9:30 ')).toEqual({ hour: 9, minute: 30 });
    expect(parseTimeText('21：15')).toEqual({ hour: 21, minute: 15 });
    expect(parseTimeText('0:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeText('24:00')).toBeNull();
    expect(parseTimeText('9:60')).toBeNull();
    expect(parseTimeText('9:3')).toBeNull();
    expect(parseTimeText('上午九点')).toBeNull();
    expect(parseTimeText('')).toBeNull();
  });

  it('快捷列表覆盖一整天，每半小时一格', () => {
    expect(TIME_PICKER_OPTIONS.map(formatTimeOfDay)).toHaveLength(48);
    expect(formatTimeOfDay(TIME_PICKER_OPTIONS[0]!)).toBe('00:00');
    expect(formatTimeOfDay(TIME_PICKER_OPTIONS.at(-1)!)).toBe('23:30');
    expect(nearestTimeOptionIndex({ hour: 9, minute: 47 })).toBe(19);
    expect(nearestTimeOptionIndex({ hour: 9, minute: 29 })).toBe(18);
  });
});
