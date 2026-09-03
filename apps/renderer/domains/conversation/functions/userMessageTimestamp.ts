function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export type UserMessageTimestampLocale = 'zh-CN' | 'en-US';

export function formatUserMessageTimestamp(
  timestamp: number,
  now: Date = new Date(),
  locale: UserMessageTimestampLocale = 'zh-CN',
): string {
  const date = new Date(timestamp);
  const sameDay = startOfLocalDay(date) === startOfLocalDay(now);
  if (sameDay) {
    return [
      pad2(date.getHours()),
      pad2(date.getMinutes()),
      pad2(date.getSeconds()),
    ].join(':');
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  if (locale === 'en-US') {
    if (sameYear) {
      return `${date.toLocaleString('en-US', { month: 'short' })} ${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }

    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  if (sameYear) {
    return `${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  return `${date.getFullYear()}年${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日`;
}

export function formatUserMessageTimestampTitle(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}
