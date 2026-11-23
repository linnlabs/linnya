import { Cron } from 'croner';
import {
  SCHEDULED_TASK_MIN_INTERVAL_MS,
  type ScheduledTaskPreviewScheduleResult,
  type ScheduledTaskSchedule,
} from '@app/schemas/scheduled-tasks';

export const MINUTE_MS = 60_000;

export type CompiledSchedule = { readonly cron: string; readonly localDateTime: null }
  | { readonly cron: null; readonly localDateTime: string };

export function compileSchedule(schedule: ScheduledTaskSchedule): CompiledSchedule {
  if (schedule.kind === 'once') return { cron: null, localDateTime: `${schedule.date}T${schedule.time}:00` };
  if (schedule.kind === 'cron') return { cron: schedule.expression, localDateTime: null };
  if (schedule.kind === 'hourly') return { cron: `${schedule.minute} */${schedule.every_hours} * * *`, localDateTime: null };

  const [hour, minute] = schedule.time.split(':').map(Number);
  const day = schedule.kind === 'monthly' ? (schedule.day === 'last' ? 'L' : schedule.day) : '*';
  const weekdays = schedule.kind === 'weekdays' ? '1-5'
    : schedule.kind === 'weekly' ? schedule.weekdays.map(value => value % 7).join(',') : '*';
  return { cron: `${minute} ${hour} ${day} * ${weekdays}`, localDateTime: null };
}

function clockFor(schedule: CompiledSchedule, timezone: string): Cron {
  return new Cron(schedule.cron ?? schedule.localDateTime, { paused: true, timezone, mode: '5-part' });
}

export function nextScheduledTime(schedule: CompiledSchedule, after: number, timezone: string): number | null {
  return clockFor(schedule, timezone).nextRun(new Date(after))?.getTime() ?? null;
}

/** 只在保存和预览时枚举未来两年，分钟检查复用已编译规则。 */
export function previewSchedule(
  schedule: ScheduledTaskSchedule,
  now: number,
  timezone: string,
): ScheduledTaskPreviewScheduleResult {
  const invalid = { ok: false, code: 'invalid_expression', message: 'Enter a valid five-field cron expression or local date.' } as const;
  if (schedule.kind === 'cron' && schedule.expression.split(/\s+/u).length !== 5) return invalid;
  if (schedule.kind === 'weekly'
    && schedule.weekdays.some((day, index, days) => index > 0 && day <= days[index - 1])) return invalid;
  if (schedule.kind === 'once' && new Date(`${schedule.date}T00:00:00Z`).toISOString().slice(0, 10) !== schedule.date) return invalid;

  let clock: Cron;
  try {
    clock = clockFor(compileSchedule(schedule), timezone);
  } catch {
    return invalid;
  }
  const next = clock.nextRun(new Date(now));
  if (!next) return schedule.kind === 'once'
    ? { ok: false, code: 'in_the_past', message: 'Choose a time in the future.' }
    : { ok: false, code: 'never_runs', message: 'This cron expression has no future occurrence.' };
  const horizon = new Date(now);
  horizon.setUTCFullYear(horizon.getUTCFullYear() + 2);
  const sample = [next.getTime()];
  let previous = next;
  for (let current = clock.nextRun(previous); current; current = clock.nextRun(previous)) {
    if (current <= horizon && current.getTime() - previous.getTime() < SCHEDULED_TASK_MIN_INTERVAL_MS) {
      return { ok: false, code: 'too_frequent', message: 'Scheduled runs must be at least one hour apart.' };
    }
    if (sample.length < 3) sample.push(current.getTime());
    if (current > horizon && sample.length === 3) break;
    previous = current;
  }
  return { ok: true, next_runs: sample };
}

/** 高水位与运行记录同事务提交。休眠很久时只保留时刻边界和次数。 */
export function elapsedScheduledTimes(
  schedule: CompiledSchedule,
  after: number,
  now: number,
  timezone: string,
): { count: number; latest: number; preceding: number | null } | null {
  if (now <= after) return null;
  const clock = clockFor(schedule, timezone);
  let count = 0;
  let preceding: number | null = null;
  let latest = after;
  for (let next = clock.nextRun(new Date(after)); next && next.getTime() <= now; next = clock.nextRun(next)) {
    preceding = count > 0 ? latest : null;
    latest = next.getTime();
    count++;
  }
  return count === 0 ? null : { count, latest, preceding };
}
