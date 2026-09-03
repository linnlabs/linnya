import { generateToolCallId } from '../../../contracts';
import { splitConcatenatedJsonObjects, tryParseJsonRecord } from '../../llm/toolCallUtils';
import type { ToolExecutionContext } from '../../tools/toolExecutionContext';
import type { StandardToolCall } from '../types';
import type { LlmCallResponse, TickPipelineContext } from './types';
import type { ToolCall } from '../../../ports';
import { CanonicalLlmUsage } from '../../../contracts';
import type {
  CanonicalLlmUsage as CanonicalLlmUsageType,
  AssistantReplayPart,
  ProviderContinuation,
  RuntimeEvent,
} from '../../../contracts';

export function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requireRuntimeIdentity(value: unknown, field: 'conversationId' | 'turnId'): string {
  const identity = readNonEmptyString(value);
  if (!identity) {
    throw new Error(`Graph execution requires a non-empty ${field}.`);
  }
  return identity;
}

export function extractResponseText(response: LlmCallResponse | undefined): string {
  if (!response) {
    return '';
  }
  if (typeof response === 'string') {
    return response;
  }
  return typeof response.content === 'string' ? response.content : '';
}

export function normalizeToolCalls(rawCalls: ToolCall[]): ToolCall[] {
  const expanded: ToolCall[] = [];
  for (const toolCall of rawCalls) {
    const argsRaw = toolCall.function?.arguments ?? '';
    const parsedDirectly = typeof argsRaw === 'string' && tryParseJsonRecord(argsRaw.trim()).ok;
    if (parsedDirectly) {
      expanded.push(toolCall);
      continue;
    }

    const pieces = typeof argsRaw === 'string' ? splitConcatenatedJsonObjects(argsRaw) : [];
    const validPieces = pieces.length >= 2 && pieces.every(piece => tryParseJsonRecord(piece).ok);
    if (validPieces) {
      expanded.push({
        ...toolCall,
        function: { ...toolCall.function, arguments: pieces[0] },
      });
      for (let index = 1; index < pieces.length; index += 1) {
        expanded.push({
          ...toolCall,
          id: generateToolCallId(),
          function: { ...toolCall.function, arguments: pieces[index] },
        });
      }
      continue;
    }

    expanded.push({
      ...toolCall,
    });
  }
  return expanded;
}

export function parsePrimaryToolArgs(
  toolCall: StandardToolCall | undefined
): Record<string, unknown> {
  if (!toolCall?.function?.arguments) {
    return {};
  }
  try {
    const parsed = JSON.parse(toolCall.function.arguments);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function resolveCanonicalUsage(
  response: LlmCallResponse | undefined
): CanonicalLlmUsageType | undefined {
  if (!response || typeof response === 'string') {
    return undefined;
  }
  const parsed = CanonicalLlmUsage.safeParse(response.canonicalUsage);
  return parsed.success ? parsed.data : undefined;
}

export function resolveToolCalls(response: LlmCallResponse | undefined): ToolCall[] | undefined {
  if (!response || typeof response === 'string') {
    return undefined;
  }
  return Array.isArray(response.tool_calls) ? response.tool_calls : undefined;
}

export function resolveProviderContinuations(
  response: LlmCallResponse | undefined
): ProviderContinuation[] | undefined {
  if (!response || typeof response === 'string') {
    return undefined;
  }
  return response.provider_continuations;
}

export function resolveAssistantReplayParts(
  response: LlmCallResponse | undefined
): AssistantReplayPart[] | undefined {
  if (!response || typeof response === 'string') return undefined;
  return response.assistant_replay_parts;
}

export function resolveToolNamesForAudit(ctx: TickPipelineContext): string[] {
  if (ctx.forceFinalAnswer || ctx.request.enableTools === false || ctx.toolSchemas.length === 0) {
    return [];
  }
  return ctx.toolSchemas.map(tool => tool.function.name);
}
