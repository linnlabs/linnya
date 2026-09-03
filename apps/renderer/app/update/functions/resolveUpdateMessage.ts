import type { MessageParams } from '@app/localization';
import { UPDATE_MESSAGE_FALLBACKS } from '../definitions/updateMessageCatalog';
import type { UpdateMessageKey, UpdateMessageResolver } from '../definitions/updateMessages';

export type UpdateRawMessageResolver = (
  key: string,
  fallback: string,
  params?: MessageParams,
) => string;

export function resolveUpdateMessage(
  key: UpdateMessageKey,
  resolveMessage: UpdateRawMessageResolver,
  params?: MessageParams,
): string {
  return resolveMessage(key, UPDATE_MESSAGE_FALLBACKS[key], params);
}

export function createUpdateMessageResolver(
  resolveMessage: UpdateRawMessageResolver,
): UpdateMessageResolver {
  return (key, params) => resolveUpdateMessage(key, resolveMessage, params);
}
