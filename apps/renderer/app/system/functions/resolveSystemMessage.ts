import type { MessageParams } from '@app/localization';
import { SYSTEM_MESSAGE_FALLBACKS } from '../definitions/systemMessageCatalog';
import type {
  SystemMessageKey,
  SystemMessageResolver,
} from '../definitions/systemMessages';

export type SystemRawMessageResolver = (
  key: string,
  fallback: string,
  params?: MessageParams,
) => string;

export function resolveSystemMessage(
  key: SystemMessageKey,
  resolveMessage: SystemRawMessageResolver,
  params?: MessageParams,
): string {
  return resolveMessage(key, SYSTEM_MESSAGE_FALLBACKS[key], params);
}

export function createSystemMessageResolver(
  resolveMessage: SystemRawMessageResolver,
): SystemMessageResolver {
  return (key, params) => resolveSystemMessage(key, resolveMessage, params);
}
