import { describe, expect, it } from 'vitest';
import {
  ScheduledTaskCreateRequestSchema,
  ScheduledTaskPreviewScheduleRequestSchema,
  ScheduledTaskScheduleSchema,
  ScheduledTaskUpdateRequestSchema,
} from './scheduled-tasks';

describe('scheduled task contract', () => {
  it('接受界面的七种时间表', () => {
    const schedules = [
      { kind: 'once', date: '2026-11-30', time: '09:00' },
      { kind: 'hourly', every_hours: 6, minute: 15 },
      { kind: 'daily', time: '22:00' },
      { kind: 'weekdays', time: '09:00' },
      { kind: 'weekly', weekdays: [1, 5], time: '10:00' },
      { kind: 'monthly', day: 'last', time: '18:30' },
      { kind: 'cron', expression: '0 9 * * 1-5' },
    ];
    for (const schedule of schedules) expect(ScheduledTaskScheduleSchema.parse(schedule)).toEqual(schedule);
  });

  it('拒绝不在界面选项里的写法', () => {
    expect(ScheduledTaskScheduleSchema.safeParse({ kind: 'daily', time: '9:00' }).success).toBe(false);
    expect(ScheduledTaskScheduleSchema.safeParse({ kind: 'hourly', every_hours: 5, minute: 0 }).success).toBe(false);
    expect(ScheduledTaskScheduleSchema.safeParse({ kind: 'monthly', day: 31, time: '09:00' }).success).toBe(false);
    expect(ScheduledTaskScheduleSchema.safeParse({ kind: 'weekly', weekdays: [0], time: '09:00' }).success).toBe(false);
  });

  it('预览可以另要一个月的运行日期，范围不能倒着也不能过长', () => {
    const schedule = { kind: 'daily', time: '09:00' };
    const request = (from: string, to: string) => ScheduledTaskPreviewScheduleRequestSchema.safeParse({ schedule, run_days_in: { from, to } }).success;
    expect(ScheduledTaskPreviewScheduleRequestSchema.parse({ schedule })).toEqual({ schedule });
    expect(request('2026-11-01', '2026-11-30')).toBe(true);
    expect(request('2026-11-30', '2026-11-30')).toBe(true);
    expect(request('2026-11-30', '2026-11-01')).toBe(false);
    expect(request('2026-01-01', '2026-12-31')).toBe(false);
    expect(request('2026-13-01', '2026-13-02')).toBe(false);
  });

  it('新建要给全字段，修改只给要改的', () => {
    const create = {
      project_id: 'p1',
      name: '每日行业新闻',
      prompt: '汇总过去 24 小时的新闻',
      agent: 'default',
      model_config_id: null,
      schedule: { kind: 'weekdays', time: '09:00' },
      missed_policy: 'run_latest',
      permission_level: 'standard',
    };
    expect(ScheduledTaskCreateRequestSchema.parse(create)).toEqual(create);
    expect(ScheduledTaskCreateRequestSchema.safeParse({ ...create, name: '  ' }).success).toBe(false);
    expect(ScheduledTaskUpdateRequestSchema.parse({ task_id: 't1', expected_revision: 3, permission_level: 'read_only' }))
      .toEqual({ task_id: 't1', expected_revision: 3, permission_level: 'read_only' });
  });
});
