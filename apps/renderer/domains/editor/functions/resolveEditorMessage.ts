import type { MessageParams } from '@app/localization';
import { EDITOR_MESSAGE_FALLBACKS } from '../definitions/editorMessageCatalog';
import type {
  EditorMessageKey,
  EditorMessageResolver,
} from '../definitions/editorMessages';

export type EditorRawMessageResolver = (
  key: string,
  fallback: string,
  params?: MessageParams,
) => string;

export function resolveEditorMessage(
  key: EditorMessageKey,
  resolveMessage: EditorRawMessageResolver,
  params?: MessageParams,
): string {
  return resolveMessage(key, EDITOR_MESSAGE_FALLBACKS[key], params);
}

export function createEditorMessageResolver(
  resolveMessage: EditorRawMessageResolver,
): EditorMessageResolver {
  return (key, params) => resolveEditorMessage(key, resolveMessage, params);
}
