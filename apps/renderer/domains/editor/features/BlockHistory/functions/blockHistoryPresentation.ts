import type { LinnyaLocale } from '@app/localization';
import type { BlockVersionOriginType } from '../../../../../shared/ipc/blockHistoryGateway';
import type { EditorMessageResolver } from '../../../definitions/editorMessages';

export function formatBlockHistoryShortTime(timestamp: number, locale: LinnyaLocale, message: EditorMessageResolver): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff >= 0 && diff < 60_000) {
    return message('editor.blockHistory.time.justNow');
  }

  if (diff >= 0 && diff < 60 * 60_000) {
    return message('editor.blockHistory.time.minutesAgo', {
      count: Math.floor(diff / 60_000),
    });
  }

  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(locale, {
      month: 'numeric',
      day: 'numeric',
    }).format(date);
  }

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

export function formatBlockHistoryFullTime(timestamp: number, locale: LinnyaLocale): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function readBlockHistoryOriginLabel(
  originType: BlockVersionOriginType,
  message: EditorMessageResolver,
): string {
  switch (originType) {
    case 'ai':
      return message('editor.blockHistory.origin.ai');
    case 'manual':
      return message('editor.blockHistory.origin.manual');
    case 'restore':
      return message('editor.blockHistory.origin.restore');
  }
}
