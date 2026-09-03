import type { ConversationMessageResolver } from '../definitions/conversationMessages';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatConversationListTime(
  timestamp: number | null | undefined,
  message: ConversationMessageResolver,
  now: Date = new Date(),
): string {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const daysDiff = Math.floor((startOfLocalDay(now) - startOfLocalDay(date)) / (1000 * 60 * 60 * 24));
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());

  if (daysDiff === 0) {
    return `${hours}:${minutes}:${seconds}`;
  }

  if (daysDiff === 1) {
    return message('conversation.date.yesterday');
  }

  if (year === now.getFullYear()) {
    return `${month}-${day}`;
  }

  return `${year}-${month}-${day}`;
}
