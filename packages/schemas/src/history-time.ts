/**
 * @file history-time.ts
 * @description 历史时间（某件事发生在什么时候）的统一显示。界面、Backend 与命令行都从这里取，不各写一份。
 *
 * 三种写法：
 * - `formatHistoryTime`：列表、侧栏、记录行里的短写法。刚刚 / 12 分钟前 / 14:32 / 昨天 14:32 / 11月9日 / 2025年11月9日。
 * - `formatHistoryDateTime`：悬停提示、详情、确认框里的完整写法。2026年11月9日 14:32。
 * - `formatAgentTimestamp`：给 Agent 和命令行的机器可读写法，带本地时区偏移：2026-11-09T14:32:05+08:00。
 *   不用 UTC 的 `Z`，免得 Agent 把 UTC 当本地时间转述给用户。
 *
 * 不显示秒；时间一律 24 小时制。比现在晚的时间（时钟不同步）在 5 分钟内算“刚刚”，更晚的按日期显示。
 * 截止日期这类面向未来的时间、时长、日志时间不归这里。
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const FUTURE_TOLERANCE_MS = 5 * MINUTE_MS;

export type HistoryTimeInput = number | string | Date;

export interface HistoryTimeOptions {
  /** 界面语言，如 `zh-CN`、`en-US`；不是中文的都按英文写“刚刚”等词。 */
  readonly locale: string;
  /** 相对时间的参照，默认当前时间；列表应传入定时刷新的时间，测试传固定值。 */
  readonly now?: HistoryTimeInput;
  /** 默认本机时区；测试用。 */
  readonly timeZone?: string;
}

interface Words {
  readonly justNow: string;
  readonly minutesAgo: (count: number) => string;
  readonly yesterday: (time: string) => string;
}

const ZH: Words = {
  justNow: '刚刚',
  minutesAgo: count => `${count} 分钟前`,
  yesterday: time => `昨天 ${time}`,
};

const EN: Words = {
  justNow: 'Just now',
  minutesAgo: count => `${count} min ago`,
  yesterday: time => `Yesterday ${time}`,
};

function wordsFor(locale: string): Words {
  return locale.toLowerCase().startsWith('zh') ? ZH : EN;
}

/** 解析成毫秒；空值、0 与无法解析的返回 null（调用方显示空）。 */
function toMs(value: HistoryTimeInput | null | undefined): number | null {
  if (value === null || value === undefined || value === '' || value === 0) return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

interface Parts { readonly year: number; readonly month: number; readonly day: number; readonly hour: number; readonly minute: number; readonly second: number }

const partFormatters = new Map<string, Intl.DateTimeFormat>();

/** 某一时刻在给定时区的日历各部分。 */
function partsOf(ms: number, timeZone: string | undefined): Parts {
  const key = timeZone ?? '';
  let formatter = partFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    partFormatters.set(key, formatter);
  }
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(formatter.formatToParts(ms).find(part => part.type === type)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
}

/** 日历日的序号，比较“今天”“昨天”用；与时区、夏令时无关。 */
function dayNumber(parts: Parts): number {
  return Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / (24 * HOUR_MS));
}

function clockText(ms: number, options: HistoryTimeOptions): string {
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(ms);
}

function dateText(ms: number, options: HistoryTimeOptions, withYear: boolean): string {
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone, month: options.locale.toLowerCase().startsWith('zh') ? 'long' : 'short', day: 'numeric',
    ...(withYear ? { year: 'numeric' as const } : {}),
  }).format(ms);
}

/** 列表里的短写法：刚刚 / 12 分钟前 / 14:32 / 昨天 14:32 / 11月9日 / 2025年11月9日。 */
export function formatHistoryTime(value: HistoryTimeInput | null | undefined, options: HistoryTimeOptions): string {
  const ms = toMs(value);
  if (ms === null) return '';
  const now = toMs(options.now ?? Date.now()) ?? Date.now();
  const words = wordsFor(options.locale);
  const diff = now - ms;
  if (diff < MINUTE_MS && diff > -FUTURE_TOLERANCE_MS) return words.justNow;
  if (diff >= MINUTE_MS && diff < HOUR_MS) return words.minutesAgo(Math.floor(diff / MINUTE_MS));
  const at = partsOf(ms, options.timeZone);
  const today = partsOf(now, options.timeZone);
  const days = dayNumber(today) - dayNumber(at);
  if (days === 0) return clockText(ms, options);
  if (days === 1) return words.yesterday(clockText(ms, options));
  return dateText(ms, options, at.year !== today.year);
}

/** 完整写法：2026年11月9日 14:32（英文 Nov 9, 2026, 14:32）。 */
export function formatHistoryDateTime(value: HistoryTimeInput | null | undefined, options: Omit<HistoryTimeOptions, 'now'>): string {
  const ms = toMs(value);
  if (ms === null) return '';
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone, year: 'numeric', month: options.locale.toLowerCase().startsWith('zh') ? 'long' : 'short',
    day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(ms);
}

const pad = (value: number, width = 2) => String(Math.abs(value)).padStart(width, '0');

/** 给 Agent 与命令行：本地时间带时区偏移，精确到秒，如 2026-11-09T14:32:05+08:00。空值返回空字符串。 */
export function formatAgentTimestamp(value: HistoryTimeInput | null | undefined, options: { readonly timeZone?: string } = {}): string {
  const ms = toMs(value);
  if (ms === null) return '';
  const local = partsOf(ms, options.timeZone);
  const offsetMinutes = Math.round(
    (Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - Math.floor(ms / 1000) * 1000) / MINUTE_MS,
  );
  const sign = offsetMinutes < 0 ? '-' : '+';
  return `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}:${pad(local.second)}`
    + `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
}
