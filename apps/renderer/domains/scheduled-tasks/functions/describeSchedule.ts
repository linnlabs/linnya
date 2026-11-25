import type { ScheduledTaskSchedule } from '@app/schemas/scheduled-tasks';
import type { ScheduledTaskMessageKey, ScheduledTaskMessageResolver } from '../definitions/scheduledTaskMessages';
import { localDateTimeToDate } from './scheduleDraft';

export function weekdayKey(day: number): ScheduledTaskMessageKey {
  return `scheduledTasks.weekday.${day}` as ScheduledTaskMessageKey;
}

/**
 * 一句话说清时间表，用在列表、详情和卡片里；钟点是合同里的本地 `HH:MM`，原样显示。
 * 一次性任务的日期由调用方按界面语言写（`useHistoryTime().scheduledDate`）。
 */
export function describeSchedule(
  schedule: ScheduledTaskSchedule,
  message: ScheduledTaskMessageResolver,
  formatDate: (epochMs: number) => string,
): string {
  switch (schedule.kind) {
    case 'once':
      return message('scheduledTasks.schedule.once', {
        date: formatDate(localDateTimeToDate(schedule.date, '00:00').getTime()),
        time: schedule.time,
      });
    case 'hourly':
      // 整点不用写“第 0 分钟”。
      if (schedule.minute === 0) {
        return schedule.every_hours === 1
          ? message('scheduledTasks.schedule.hourlyOnTheHour')
          : message('scheduledTasks.schedule.everyHoursOnTheHour', { hours: schedule.every_hours });
      }
      return schedule.every_hours === 1
        ? message('scheduledTasks.schedule.hourly', { minute: schedule.minute })
        : message('scheduledTasks.schedule.everyHours', { hours: schedule.every_hours, minute: schedule.minute });
    case 'daily':
      return message('scheduledTasks.schedule.daily', { time: schedule.time });
    case 'weekdays':
      return message('scheduledTasks.schedule.weekdays', { time: schedule.time });
    case 'weekly':
      return message('scheduledTasks.schedule.weekly', {
        days: [...new Set(schedule.weekdays)].sort((a, b) => a - b)
          .map(day => message(weekdayKey(day)))
          .join(message('scheduledTasks.schedule.daySeparator')),
        time: schedule.time,
      });
    case 'monthly':
      return schedule.day === 'last'
        ? message('scheduledTasks.schedule.monthlyLast', { time: schedule.time })
        : message('scheduledTasks.schedule.monthly', { day: schedule.day, time: schedule.time });
    case 'cron':
      return message('scheduledTasks.schedule.cron', { expression: schedule.expression });
  }
}
