import { parseUserFacingMessage } from '@app/schemas';
import type { UserFacingMessage } from '@app/schemas';
import type { SystemMessageKey } from '../definitions/systemMessages';
import {
  isSystemMessageKey,
  resolveCurrentSystemMessage,
} from './resolveCurrentSystemMessage';

export interface SystemOperationFailureLike {
  readonly error?: string;
  readonly userMessage?: UserFacingMessage;
}

export function resolveCurrentSystemOperationFailure(
  failure: SystemOperationFailureLike,
  fallbackKey: SystemMessageKey,
): string {
  const message = parseUserFacingMessage(failure.userMessage);
  if (message && isSystemMessageKey(message.key)) {
    return resolveCurrentSystemMessage(message.key, message.params);
  }

  return resolveCurrentSystemMessage(fallbackKey);
}
