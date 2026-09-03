import type {
  ToolConversationScope,
  ToolConversationScopeContext,
} from '../definitions/toolConversationScope';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveToolConversationId(
  context: ToolConversationScopeContext,
): string | undefined {
  return readNonEmptyString(context.conversationId);
}

export function resolveToolConversationInstanceId(
  context: ToolConversationScopeContext,
): string {
  return readNonEmptyString(context.research?.instanceId) ?? 'default';
}

export function requireToolConversationScope(params: {
  readonly context: ToolConversationScopeContext;
  readonly errorPrefix: string;
}): ToolConversationScope {
  const conversationId = resolveToolConversationId(params.context);
  if (!conversationId) {
    throw new Error(`${params.errorPrefix} 缺少 context.conversationId`);
  }
  return {
    conversationId,
    instanceId: resolveToolConversationInstanceId(params.context),
  };
}

export function assertToolConversationScopeContext(
  context: unknown,
  errorPrefix = '[tool_conversation_scope]',
): asserts context is ToolConversationScopeContext {
  if (!isRecord(context)) {
    throw new Error(`${errorPrefix} 工具上下文必须是对象`);
  }
  requireToolConversationScope({ context, errorPrefix });
}
