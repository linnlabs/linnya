import { describe, expect, it } from 'vitest';
import { presetFromCron } from './presetFromCron';

describe('与预设等价的 cron', () => {
  it('认出 Host 会为各预设生成的写法', () => {
    expect(presetFromCron('0 9 * * *')).toEqual({ kind: 'daily', time: '09:00' });
    expect(presetFromCron('30 8 * * 1-5')).toEqual({ kind: 'weekdays', time: '08:30' });
    expect(presetFromCron('0 10 * * 1,5')).toEqual({ kind: 'weekly', weekdays: [1, 5], time: '10:00' });
    expect(presetFromCron('0 10 * * 0')).toEqual({ kind: 'weekly', weekdays: [7], time: '10:00' });
    expect(presetFromCron('30 18 L * *')).toEqual({ kind: 'monthly', day: 'last', time: '18:30' });
    expect(presetFromCron('0 9 15 * *')).toEqual({ kind: 'monthly', day: 15, time: '09:00' });
    expect(presetFromCron('15 */6 * * *')).toEqual({ kind: 'hourly', every_hours: 6, minute: 15 });
    expect(presetFromCron('0 * * * *')).toEqual({ kind: 'hourly', every_hours: 1, minute: 0 });
  });

  it('同一时间的其他常见写法也归到同一预设', () => {
    expect(presetFromCron('  00  09 * * 7 ')).toEqual({ kind: 'weekly', weekdays: [7], time: '09:00' });
    expect(presetFromCron('0 9 * * 1,2,3,4,5')).toEqual({ kind: 'weekdays', time: '09:00' });
    expect(presetFromCron('0 9 * * 0-6')).toEqual({ kind: 'daily', time: '09:00' });
    expect(presetFromCron('0 9 * * 5,1,1')).toEqual({ kind: 'weekly', weekdays: [1, 5], time: '09:00' });
  });

  it('预设表达不了的保持自定义', () => {
    for (const expression of [
      '0 9 31 * *', '0 9 0 * *', '0 9 1,15 * *', '*/30 * * * *', '0 */5 * * *', '0 9 * 1 *', '0 9 1 * 1',
      '0 9 * * MON', '0 9-17 * * *', '0 9 * *', '0 24 * * *', '60 9 * * *', '0 9 * * 1-3-5', '0 9 * * 5-1',
    ]) {
      expect(presetFromCron(expression), expression).toBeNull();
    }
  });
});
