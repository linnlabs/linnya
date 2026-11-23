import { describe, expect, it } from 'vitest';
import { previewSchedule } from '../functions/scheduleTime';

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
});
