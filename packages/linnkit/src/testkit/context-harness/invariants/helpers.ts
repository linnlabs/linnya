import type { AiMessage } from '../../../contracts';
import type {
  ContextTrace,
  ContextTraceMessageDecisionEvent,
  ContextTraceProviderEvent,
} from '../../../context-manager';
import type {
  ContextPolicyInvariantFailure,
  ContextPolicyInvariantId,
} from './types';

export function failure(
  id: ContextPolicyInvariantId,
  title: string,
  message: string,
  details?: Record<string, unknown>,
): ContextPolicyInvariantFailure {
  return details === undefined ? { id, title, message } : { id, title, message, details };
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortJson(record[key]);
      return acc;
    }, {});
}

export function messageDecisionEvents(trace: ContextTrace): ContextTraceMessageDecisionEvent[] {
  return trace.events.filter((event): event is ContextTraceMessageDecisionEvent => {
    return event.kind === 'message-decision';
  });
}

export function providerEvents(trace: ContextTrace): ContextTraceProviderEvent[] {
  return trace.events.filter((event): event is ContextTraceProviderEvent => {
    return event.kind === 'provider';
  });
}

export function decisionsByMessageId(trace: ContextTrace): Map<string, ContextTraceMessageDecisionEvent> {
  const decisions = new Map<string, ContextTraceMessageDecisionEvent>();
  for (const event of messageDecisionEvents(trace)) {
    if (event.messageId) {
      decisions.set(event.messageId, event);
    }
  }
  return decisions;
}

export function toolCallIds(message: AiMessage): string[] {
  if (message.type !== 'tool_calls') {
    return [];
  }
  return message.metadata?.tool_calls?.map((toolCall) => toolCall.id) ?? [];
}

export function toolOutputCallId(message: AiMessage): string | undefined {
  return message.type === 'tool_output' ? message.metadata?.tool_call_id : undefined;
}
