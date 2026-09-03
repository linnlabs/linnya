import { describe, expect, it } from 'vitest';

import {
  formatUserMessageTimestamp,
  formatUserMessageTimestampTitle,
} from './userMessageTimestamp';

describe('formatUserMessageTimestamp', () => {
  const now = new Date(2026, 5, 18, 12, 30, 0);

  it('shows seconds for messages from today', () => {
    const timestamp = new Date(2026, 5, 18, 9, 7, 5).getTime();

    expect(formatUserMessageTimestamp(timestamp, now)).toBe('09:07:05');
  });

  it('shows month, day, hour and minute for yesterday and the day before yesterday', () => {
    const yesterday = new Date(2026, 5, 17, 23, 8, 9).getTime();
    const beforeYesterday = new Date(2026, 5, 16, 1, 2, 3).getTime();

    expect(formatUserMessageTimestamp(yesterday, now)).toBe('06月17日 23:08');
    expect(formatUserMessageTimestamp(beforeYesterday, now)).toBe('06月16日 01:02');
  });

  it('shows month, day, hour and minute for other messages in the current year', () => {
    const timestamp = new Date(2026, 0, 5, 6, 7, 8).getTime();

    expect(formatUserMessageTimestamp(timestamp, now)).toBe('01月05日 06:07');
  });

  it('shows year, month and day for messages from previous years', () => {
    const timestamp = new Date(2025, 11, 31, 23, 59, 59).getTime();

    expect(formatUserMessageTimestamp(timestamp, now)).toBe('2025年12月31日');
  });

  it('formats non-today timestamps for English locale', () => {
    const currentYear = new Date(2026, 0, 5, 6, 7, 8).getTime();
    const previousYear = new Date(2025, 11, 31, 23, 59, 59).getTime();

    expect(formatUserMessageTimestamp(currentYear, now, 'en-US')).toBe('Jan 05 06:07');
    expect(formatUserMessageTimestamp(previousYear, now, 'en-US')).toBe('2025-12-31');
  });

  it('returns a full timestamp for the title', () => {
    const timestamp = new Date(2026, 5, 18, 9, 7, 5).getTime();

    expect(formatUserMessageTimestampTitle(timestamp)).toBe('2026-06-18 09:07:05');
  });
});
