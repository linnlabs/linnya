import type { TimeOfDay } from '../definitions/timePicker';

/** 半小时一格的快捷选项；列表以外的分钟直接输入。 */
export const TIME_PICKER_OPTIONS: readonly TimeOfDay[] = Array.from({ length: 48 }, (_, index) => ({
  hour: Math.floor(index / 2),
  minute: index % 2 === 0 ? 0 : 30,
}));

export function formatTimeOfDay({ hour, minute }: TimeOfDay): string {
  return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`;
}

/** 认得 9、930、0930、9:30 和全角冒号；认不出或超出一天时返回 null。 */
export function parseTimeText(text: string): TimeOfDay | null {
  const match = /^(\d{1,2})(?:[:：]?(\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** 打开列表时定位到当前时间，没有就取它之前最近的一格。 */
export function nearestTimeOptionIndex(time: TimeOfDay): number {
  return time.hour * 2 + (time.minute >= 30 ? 1 : 0);
}
