import { describe, expect, it } from 'vitest';
import { previewSchedule, scheduledRunDays } from '../functions/scheduleTime';

const preview = (time: string, now: string) => previewSchedule({ kind: 'daily', time }, Date.parse(now), 'America/New_York');

describe('scheduled task wall-clock rules', () => {
  it('runs at 03:00 when the spring clock skips 02:30', () => {
    expect(preview('02:30', '2026-03-07T14:00Z')).toEqual({ ok: true, next_runs: [
      Date.parse('2026-03-08T07:00Z'), Date.parse('2026-03-09T06:30Z'), Date.parse('2026-03-10T06:30Z'),
    ] });
  });

  it('runs once at 01:30 when the fall clock repeats it', () => {
    expect(preview('01:30', '2026-10-31T14:00Z')).toEqual({ ok: true, next_runs: [
      Date.parse('2026-11-01T05:30Z'), Date.parse('2026-11-02T06:30Z'), Date.parse('2026-11-03T06:30Z'),
    ] });
  });

  it('rejects a cron whose calendar intersection breaks the one-hour rule later in the preview horizon', () => {
    const now = Date.parse('2026-01-01Z');
    expect(previewSchedule({ kind: 'cron', expression: '0,30 3 1 7 *' }, now, 'UTC')).toMatchObject({ ok: false, code: 'too_frequent' });
    expect(previewSchedule({ kind: 'cron', expression: '0 3 30 2 *' }, now, 'UTC')).toMatchObject({ ok: false, code: 'never_runs' });
  });

  it('lists the local days a rule still runs on, not the UTC ones', () => {
    // 上海 9 月 10 日 08:30；07:00 已过，今天不再算。
    const now = Date.parse('2026-09-10T00:30Z');
    const september = { from: '2026-09-01', to: '2026-09-30' };
    expect(scheduledRunDays({ kind: 'weekly', weekdays: [4, 7], time: '07:00' }, september, now, 'Asia/Shanghai')).toEqual([
      '2026-09-13', '2026-09-17', '2026-09-20', '2026-09-24', '2026-09-27',
    ]);
    expect(scheduledRunDays({ kind: 'monthly', day: 'last', time: '00:30' }, september, now, 'Asia/Shanghai')).toEqual(['2026-09-30']);
    expect(scheduledRunDays({ kind: 'daily', time: '00:30' }, { from: '2026-10-01', to: '2026-10-03' }, now, 'Asia/Shanghai')).toEqual([
      '2026-10-01', '2026-10-02', '2026-10-03',
    ]);
    expect(scheduledRunDays({ kind: 'daily', time: '23:30' }, { from: '2026-10-01', to: '2026-10-02' }, now, 'America/Los_Angeles')).toEqual([
      '2026-10-01', '2026-10-02',
    ]);
  });

  it('counts a day once when the rule runs every hour, and leaves past months empty', () => {
    const now = Date.parse('2026-09-10T12:00Z');
    expect(scheduledRunDays({ kind: 'hourly', every_hours: 1, minute: 0 }, { from: '2026-09-09', to: '2026-09-11' }, now, 'UTC')).toEqual([
      '2026-09-10', '2026-09-11',
    ]);
    expect(scheduledRunDays({ kind: 'daily', time: '09:00' }, { from: '2026-08-01', to: '2026-08-31' }, now, 'UTC')).toEqual([]);
  });
});
