import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { ScheduledTaskCreateRequestSchema } from '@app/schemas/scheduled-tasks';
import { parseSchedulesCommand } from '../functions/parseSchedulesCommand';
import { prepareSchedulesCli, SCHEDULES_USAGE } from '../orchestration/prepareSchedulesCli';

// 参数错误在执行前返回，不触达数据库。
const db = new Database(':memory:');
afterAll(() => db.close());

describe('linnya schedules arguments', () => {
  it('accepts a one-time schedule without any quotes', () => {
    const parsed = parseSchedulesCommand('create', ['--name', 'Reminder', '--prompt', 'Check the draft', '--once', '2027-01-01T09:00']);
    expect(parsed.fields.schedule).toEqual({ kind: 'once', date: '2027-01-01', time: '09:00' });
    expect(ScheduledTaskCreateRequestSchema.safeParse({ ...parsed.fields, project_id: 'project-1', agent: 'default',
      model_config_id: null, missed_policy: 'run_latest', permission_level: 'standard' }).success).toBe(true);
    expect(parseSchedulesCommand('create', ['--once', '2027-01-01 09:00']).fields.schedule)
      .toEqual({ kind: 'once', date: '2027-01-01', time: '09:00' });
  });

  it('rejects malformed one-time values and more than one timing option', () => {
    expect(() => parseSchedulesCommand('create', ['--once', 'tomorrow 9am'])).toThrow(/YYYY-MM-DDTHH:MM/u);
    expect(() => parseSchedulesCommand('create', ['--once', '2027-01-01T09:00', '--cron', '0 9 * * *'])).toThrow(/only one/u);
    expect(() => parseSchedulesCommand('update', ['task-1', '--schedule', '{}', '--cron', '0 9 * * *'])).toThrow(/only one/u);
  });

  it('points JSON that lost its quotes in the shell back to --once or --cron', () => {
    const stripped = '{kind:once,date:2027-01-01,time:09:00}';
    const prepared = prepareSchedulesCli(db, ['create', '--name', 'Reminder', '--prompt', 'Check', '--schedule', stripped]);
    expect(prepared).toMatchObject({ status: 'completed', result: { exitCode: 2, stderr: expect.stringContaining('use --once or --cron') } });
  });

  it('keeps cron and JSON schedules working and recommends quote-free forms in help', () => {
    expect(parseSchedulesCommand('create', ['--cron', '0 9 * * *']).fields.schedule).toEqual({ kind: 'cron', expression: '0 9 * * *' });
    expect(parseSchedulesCommand('update', ['task-1', '--schedule', '{"kind":"daily","time":"09:00"}']).fields.schedule)
      .toEqual({ kind: 'daily', time: '09:00' });
    expect(SCHEDULES_USAGE).toContain('--once 2027-01-01T09:00');
    expect(SCHEDULES_USAGE).not.toContain('{"kind":"once"');
  });
});
