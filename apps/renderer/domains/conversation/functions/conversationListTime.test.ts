import { describe, expect, it } from 'vitest';
import type { ConversationMessageResolver } from '../definitions/conversationMessages';
import { formatConversationListTime } from './conversationListTime';

const message: ConversationMessageResolver = (key) => {
  if (key === 'conversation.date.yesterday') return '昨天';
  return key;
};

describe('formatConversationListTime', () => {
  const now = new Date(2026, 5, 18, 12, 30, 0);

  it('shows time for conversations from today', () => {
    const timestamp = new Date(2026, 5, 18, 9, 7, 5).getTime();

    expect(formatConversationListTime(timestamp, message, now)).toBe('09:07:05');
  });

  it('uses localized yesterday text', () => {
    const timestamp = new Date(2026, 5, 17, 23, 8, 9).getTime();

    expect(formatConversationListTime(timestamp, message, now)).toBe('昨天');
  });

  it('shows short dates for the current year and full dates across years', () => {
    const currentYear = new Date(2026, 0, 5, 6, 7, 8).getTime();
    const previousYear = new Date(2025, 11, 31, 23, 59, 59).getTime();

    expect(formatConversationListTime(currentYear, message, now)).toBe('01-05');
    expect(formatConversationListTime(previousYear, message, now)).toBe('2025-12-31');
  });
});
