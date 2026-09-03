import type { ToolCall } from './caller.types';
import { tryParseJsonRecord } from './toolCallUtils';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isToolCall = (value: unknown): value is ToolCall => {
  if (!isRecord(value)) return false;
  if (typeof value['id'] !== 'string') return false;
  if (value['type'] !== 'function') return false;
  const fn = value['function'];
  if (!isRecord(fn)) return false;
  return typeof fn['name'] === 'string' && typeof fn['arguments'] === 'string';
};

export const toToolCalls = (value: unknown): ToolCall[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isToolCall);
};

function summarizeToolArguments(rawArguments: string): { length: number; head: string; tail: string } {
  const previewChars = 160;
  return {
    length: rawArguments.length,
    head: rawArguments.slice(0, previewChars),
    tail: rawArguments.slice(Math.max(0, rawArguments.length - previewChars)),
  };
}

/**
 * 流式工具调用回放守卫。
 *
 * 中文备注：
 * - 这里不尝试修复半截 JSON，因为那会把模型输出损坏伪装成合法工具调用；
 * - 抛错后由 retry/fallback 层决定是否重试或切模型。
 */
export function assertToolCallsHaveValidJsonArguments(toolCalls: ToolCall[]): void {
  for (const toolCall of toolCalls) {
    const rawArguments = toolCall.function.arguments;
    const parsed = tryParseJsonRecord(rawArguments.trim());
    if (parsed.ok) {
      continue;
    }

    const summary = summarizeToolArguments(rawArguments);
    const trimmed = rawArguments.trim();
    const endsWithClosingBrace = trimmed.endsWith('}');
    const startsWithOpeningBrace = trimmed.startsWith('{');
    const truncationHint = startsWithOpeningBrace && !endsWithClosingBrace
      ? '(疑似输出中途被截断，可能是 max_tokens 不足)'
      : '(非典型截断模式，需进一步排查)';

    throw new Error(
      [
        `[LlmCaller] Stream ended with invalid tool_call.arguments for ${toolCall.function.name} (${toolCall.id}).`,
        `length=${summary.length}`,
        `head=${summary.head}`,
        `tail=${summary.tail}`,
        truncationHint,
      ].join(' ')
    );
  }
}
