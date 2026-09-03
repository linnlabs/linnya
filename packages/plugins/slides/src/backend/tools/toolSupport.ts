import type { ToolContext } from '@plugin/backend/toolRuntime';
import {
  readPresentationInspectTargetResolverFromToolContext,
  readPresentationCoordinatorFromToolContext,
} from './toolContextBinding';
import type {
  CodegenPresentationServicePort,
  PresentationInspectTargetResolver,
  PresentationToolCoordinatorPort,
} from './types';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
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

export function requireCodegenPresentationService(context: ToolContext): CodegenPresentationServicePort {
  return requirePresentationCoordinator(context).getCodegenPresentationService();
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

export function readOptionalNonEmptyStringArgStrict(
  args: Record<string, unknown>,
  key: string,
): string | null {
  const value = args[key];
  if (value == null) return null;
  if (!isNonEmptyString(value)) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

export function readOptionalPositiveIntegerArg(
  args: Record<string, unknown>,
  key: string,
): number | null {
  const value = args[key];
  if (value == null) return null;
  return isPositiveInteger(value) ? value : null;
}

export function readOptionalPositiveIntegerArgStrict(
  args: Record<string, unknown>,
  key: string,
): number | null {
  const value = args[key];
  if (value == null) return null;
  if (!isPositiveInteger(value)) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return value;
}

export function readOptionalNonNegativeIntegerArg(
  args: Record<string, unknown>,
  key: string,
): number | null {
  const value = args[key];
  if (value == null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function readOptionalNonNegativeIntegerArgStrict(
  args: Record<string, unknown>,
  key: string,
): number | null {
  const value = args[key];
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer.`);
  }
  return value;
}

export function readOptionalBooleanArgStrict(
  args: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = args[key];
  if (value == null) return null;
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean.`);
  }
  return value;
}
