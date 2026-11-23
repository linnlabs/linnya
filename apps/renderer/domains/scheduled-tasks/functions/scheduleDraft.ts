import {
  SCHEDULED_TASK_HOURLY_INTERVALS,
  type ScheduledTaskSchedule,
} from '@app/schemas/scheduled-tasks';

export type ScheduleKind = ScheduledTaskSchedule['kind'];
export type HourlyInterval = (typeof SCHEDULED_TASK_HOURLY_INTERVALS)[number];

/**
 * 编辑表单里的时间表草稿：每种重复方式各自的字段都保留，切换方式时不丢用户填过的值，
 * 保存时只取当前方式需要的字段。
 */
export interface ScheduleDraft {
  readonly kind: ScheduleKind;
  /** 本地日期 YYYY-MM-DD，一次性用。 */
  readonly date: string;
  /** 本地钟点 HH:MM。 */
  readonly time: string;
  readonly everyHours: HourlyInterval;
  readonly minute: number;
  /** ISO 星期，1 是周一。 */
  readonly weekdays: readonly number[];
  readonly monthDay: number | 'last';
  readonly expression: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocalTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 把本地日期与钟点合成一个 Date，给日期、时间选择器用。 */
export function localDateTimeToDate(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

/** 新任务默认每个工作日 9:00；一次性默认明天。 */
export function createScheduleDraft(schedule: ScheduledTaskSchedule | null, now: Date): ScheduleDraft {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const isoToday = ((now.getDay() + 6) % 7) + 1;
  const base: ScheduleDraft = {
    kind: 'weekdays',
    date: toLocalDate(tomorrow),
    time: '09:00',
    everyHours: 1,
    minute: 0,
    weekdays: [isoToday],
    monthDay: 1,
    expression: '0 9 * * 1-5',
  };
  if (!schedule) return base;
  switch (schedule.kind) {
    case 'once':
      return { ...base, kind: 'once', date: schedule.date, time: schedule.time };
    case 'hourly':
      return { ...base, kind: 'hourly', everyHours: schedule.every_hours, minute: schedule.minute };
    case 'daily':
    case 'weekdays':
      return { ...base, kind: schedule.kind, time: schedule.time };
    case 'weekly':
      return { ...base, kind: 'weekly', weekdays: [...schedule.weekdays], time: schedule.time };
    case 'monthly':
      return { ...base, kind: 'monthly', monthDay: schedule.day, time: schedule.time };
    case 'cron':
      return { ...base, kind: 'cron', expression: schedule.expression };
  }
}

export function scheduleFromDraft(draft: ScheduleDraft): ScheduledTaskSchedule {
  switch (draft.kind) {
    case 'once':
      return { kind: 'once', date: draft.date, time: draft.time };
    case 'hourly':
      return { kind: 'hourly', every_hours: draft.everyHours, minute: draft.minute };
    case 'daily':
      return { kind: 'daily', time: draft.time };
    case 'weekdays':
      return { kind: 'weekdays', time: draft.time };
    case 'weekly':
      return { kind: 'weekly', weekdays: [...new Set(draft.weekdays)].sort((a, b) => a - b), time: draft.time };
    case 'monthly':
      return { kind: 'monthly', day: draft.monthDay, time: draft.time };
    case 'cron':
      return { kind: 'cron', expression: draft.expression.trim().replace(/\s+/gu, ' ') };
  }
}

/** 至少保留一天：取消最后一个选中的星期时不生效。 */
export function toggleWeekday(weekdays: readonly number[], day: number): readonly number[] {
  if (weekdays.includes(day)) {
    return weekdays.length === 1 ? weekdays : weekdays.filter(value => value !== day);
  }
  return [...weekdays, day].sort((a, b) => a - b);
}
