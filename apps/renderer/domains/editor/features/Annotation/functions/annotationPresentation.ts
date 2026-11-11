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
