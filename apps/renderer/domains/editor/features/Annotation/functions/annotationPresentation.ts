import type { EditorMessageResolver } from '../../../definitions/editorMessages';

export function resolveAnnotationAuthorName(
  author: unknown,
  editorMessage: EditorMessageResolver,
): string {
  if (typeof author !== 'string') return editorMessage('editor.annotation.author.user');

  const normalized = author.trim();
  if (normalized.length === 0 || normalized === '用户' || normalized === 'User') {
    return editorMessage('editor.annotation.author.user');
  }

  return normalized;
}

export function formatAnnotationTime(
  timestamp: number | string,
  editorMessage: EditorMessageResolver,
): string {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysDiff = Math.floor((nowOnly.getTime() - dateOnly.getTime()) / (1000 * 60 * 60 * 24));

  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  if (daysDiff === 0) return `${hours}:${minutes}:${seconds}`;
  if (daysDiff === 1) return editorMessage('editor.annotation.time.yesterday');
  if (year === now.getFullYear()) return `${month}-${day}`;
  return `${year}-${month}-${day}`;
}
