/**
 * @file src/shared/utils/isoWeek.ts
 *
 * @description
 * ISO Week（周一为一周开始）相关工具函数。
 *
 * Cloud 统计约定：
 * - week_key 形如：`YYYY-WW`（例如 2026-05）。
 * - “周”按本地时区计算：周一 00:00:00 为新的一周开始。
 */

/**
 * 将 JS 的 getDay()（周日=0）转换为 ISO 语义的 weekday（周一=0, 周日=6）
 */
function getIsoWeekdayIndex(date: Date): number {
  // JS: 0=Sunday ... 6=Saturday
  // ISO-index: 0=Monday ... 6=Sunday
  return (date.getDay() + 6) % 7;
}

/**
 * 返回“本地时区”的当天零点（00:00:00.000）
 */
function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/**
 * 返回 ISO 周的周一 00:00（本地时区）
 */
export function startOfIsoWeekLocal(date: Date): Date {
  const d0 = startOfLocalDay(date);
  const isoIdx = getIsoWeekdayIndex(d0);
  const start = new Date(d0);
  start.setDate(d0.getDate() - isoIdx);
  return start;
}

/**
 * 返回下一周的周一 00:00（本地时区）
 */
export function startOfNextIsoWeekLocal(date: Date): Date {
  const start = startOfIsoWeekLocal(date);
  const next = new Date(start);
  next.setDate(start.getDate() + 7);
  return next;
}

/**
 * 计算 ISO week-year 与 week number（本地时区口径）
 *
 * 实现要点（经典算法）：
 * - 取“当前周的周四”作为 week-year 的判定基准
 * - week 1：包含 1 月 4 日的那一周
 */
export function getIsoWeekYearAndNumberLocal(date: Date): { weekYear: number; weekNumber: number } {
  // 先把时间归一到本地日初，避免跨天边界导致的波动
  const d0 = startOfLocalDay(date);

  // 1) 找到本周的周四（周一=0 -> 周四=3）
  const isoIdx = getIsoWeekdayIndex(d0);
  const thursday = new Date(d0);
  thursday.setDate(d0.getDate() + (3 - isoIdx));

  const weekYear = thursday.getFullYear();

  // 2) weekYear 的 week1：包含 1月4日 的那周的周一
  const jan4 = new Date(weekYear, 0, 4, 0, 0, 0, 0);
  const week1Start = startOfIsoWeekLocal(jan4);

  // 3) 当前周的周一
  const currentWeekStart = startOfIsoWeekLocal(d0);

  const diffMs = currentWeekStart.getTime() - week1Start.getTime();
  const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
  const weekNumber = diffWeeks + 1;

  return { weekYear, weekNumber };
}

/**
 * week_key（YYYY-WW）
 */
export function getIsoWeekKeyLocal(date: Date): string {
  const { weekYear, weekNumber } = getIsoWeekYearAndNumberLocal(date);
  const ww = String(weekNumber).padStart(2, '0');
  return `${weekYear}-${ww}`;
}
