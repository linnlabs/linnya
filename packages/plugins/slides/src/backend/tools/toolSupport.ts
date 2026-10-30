import type { ToolContext } from '@plugin/backend/toolRuntime';
import {
  readPresentationInspectTargetResolverFromToolContext,
  readPresentationCoordinatorFromToolContext,
} from './toolContextBinding';
import type {
  PresentationInspectTargetResolver,
  PresentationToolCoordinatorPort,
} from './types';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getPresentationCoordinator(
  context: ToolContext,
): PresentationToolCoordinatorPort | undefined {
  return readPresentationCoordinatorFromToolContext(context);
}

export function requirePresentationCoordinator(
  context: ToolContext,
): PresentationToolCoordinatorPort {
  const coordinator = getPresentationCoordinator(context);
  if (!coordinator) {
    throw new Error('Presentation service not available in tool context.');
  }
  return coordinator;
}

export function requirePresentationInspectTargetResolver(
  context: ToolContext,
): PresentationInspectTargetResolver {
  const resolver = readPresentationInspectTargetResolverFromToolContext(context);
  if (!resolver) {
    throw new Error('Presentation inspect target resolver not available in tool context.');
  }
  return resolver;
}

export function requireConversationId(context: ToolContext): string {
  const conversationId = context.conversationId;
  if (typeof conversationId !== 'string' || conversationId.trim().length === 0) {
    throw new Error('No conversation context available.');
  }
  return conversationId.trim();
}

export function readRequiredStringArg(
  args: Record<string, unknown>,
  key: string,
): string | null {
  const value = args[key];
  return isNonEmptyString(value) ? value.trim() : null;
}
