import {
  SCHEDULED_TASK_HOURLY_INTERVALS,
  ScheduledTaskScheduleSchema,
  type ScheduledTaskSchedule,
} from '@app/schemas/scheduled-tasks';

type PresetSchedule = Exclude<ScheduledTaskSchedule, { kind: 'cron' } | { kind: 'once' }>;

const NUMBER = /^\d{1,2}$/u;

function readNumber(field: string, max: number): number | null {
  if (!NUMBER.test(field)) return null;
  const value = Number(field);
  return value <= max ? value : null;
}

/** 星期字段：逗号分隔的数字或区间，0 与 7 都是周日。转成升序、不重复的 ISO 星期（1 是周一）。 */
function readWeekdays(field: string): number[] | null {
  const days = new Set<number>();
  for (const part of field.split(',')) {
    const [from, to = from] = part.split('-');
    const start = readNumber(from ?? '', 7);
    const end = readNumber(to, 7);
    if (start === null || end === null || start > end || part.split('-').length > 2) return null;
    for (let day = start; day <= end; day += 1) days.add(day === 0 ? 7 : day);
  }
  return [...days].sort((a, b) => a - b);
}

function readHourly(minute: number, hour: string): PresetSchedule | null {
  const everyHours = hour === '*' ? 1 : hour.startsWith('*/') ? readNumber(hour.slice(2), 23) : null;
  const interval = SCHEDULED_TASK_HOURLY_INTERVALS.find(value => value === everyHours);
  return interval === undefined ? null : { kind: 'hourly', every_hours: interval, minute };
}

function readAtTime(time: string, dayOfMonth: string, weekdayField: string): PresetSchedule | null {
  if (dayOfMonth === '*' && weekdayField === '*') return { kind: 'daily', time };
  if (dayOfMonth === '*') {
    const weekdays = readWeekdays(weekdayField);
    if (!weekdays) return null;
    if (weekdays.length === 7) return { kind: 'daily', time };
    if (weekdays.join() === '1,2,3,4,5') return { kind: 'weekdays', time };
    return { kind: 'weekly', weekdays, time };
  }
  if (weekdayField !== '*') return null;
  if (dayOfMonth === 'L') return { kind: 'monthly', day: 'last', time };
  const day = readNumber(dayOfMonth, 28);
  return day === null || day === 0 ? null : { kind: 'monthly', day, time };
}

/**
 * 与某个预设完全等价的 cron 认作那个预设：Agent 用 `--cron "0 9 * * 1-5"` 建的任务和界面选的
 * “工作日 09:00”显示、编辑都一样。只认 Host `compileSchedule` 会生成的写法（另接受周日写 7、
 * 前导零和星期列表/区间），日与星期同时限定、步长、名称写法等一律保持自定义。
 */
export function presetFromCron(expression: string): PresetSchedule | null {
  const fields = expression.trim().split(/\s+/u);
  if (fields.length !== 5) return null;
  const [minuteField, hourField, dayOfMonth, month, weekdayField] = fields;
  if (month !== '*') return null;
  const minute = readNumber(minuteField, 59);
  if (minute === null) return null;

  let preset: PresetSchedule | null;
  if (hourField === '*' || hourField.startsWith('*/')) {
    preset = dayOfMonth === '*' && weekdayField === '*' ? readHourly(minute, hourField) : null;
  } else {
    const hour = readNumber(hourField, 23);
    const time = hour === null ? null : `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    preset = time === null ? null : readAtTime(time, dayOfMonth, weekdayField);
  }
  return preset && ScheduledTaskScheduleSchema.safeParse(preset).success ? preset : null;
}
