const DAY_OFFSETS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/** 方向键在月历里移动到哪一天；不是移动键时返回 null。 */
export function moveCalendarDate(date: Date, key: string): Date | null {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const offset = DAY_OFFSETS[key];
  if (offset !== undefined) return new Date(year, month, day + offset);
  if (key === 'Home') return new Date(year, month, day - ((date.getDay() + 6) % 7));
  if (key === 'End') return new Date(year, month, day + ((7 - date.getDay()) % 7));
  if (key === 'PageUp') return moveMonth(date, -1);
  if (key === 'PageDown') return moveMonth(date, 1);
  return null;
}

/** 跨月时 31 日落到目标月的最后一天，不溢出到再下一个月。 */
function moveMonth(date: Date, offset: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
}
