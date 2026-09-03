import type { LlmRequestMessage } from '@linnlabs/linnkit/ports';

export interface FunctionToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly parameters: Record<string, unknown>;
}

export interface FunctionToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function appendEndpoint(baseURL: string, endpoint: string): string {
  const normalizedBase = baseURL.replace(/\/+$/, '');
  const normalizedEndpoint = endpoint.replace(/^\/+/, '');
  return normalizedBase.endsWith(`/${normalizedEndpoint}`)
    ? normalizedBase
    : `${normalizedBase}/${normalizedEndpoint}`;
}

export function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`[TokenAccounting] ${field} 必须是非负整数。`);
  }
  return value;
}

export function readMessageText(message: LlmRequestMessage): string {
  if ('attachments' in message && message.attachments && message.attachments.length > 0) {
    throw new Error('[TokenAccounting] remote count 尚未接收已物化图片输入。');
  }
  if (
    message.role === 'assistant' &&
    (('assistant_replay_parts' in message && message.assistant_replay_parts?.length) ||
      ('provider_continuations' in message && message.provider_continuations?.length) ||
      ('metadata' in message &&
        isRecord(message.metadata) &&
        (Array.isArray(message.metadata.assistant_replay_parts) ||
          Array.isArray(message.metadata.provider_continuations))))
  ) {
    throw new Error('[TokenAccounting] remote count 尚未接收 Provider continuation 输入。');
  }
  if (typeof message.content !== 'string') {
    throw new Error(`[TokenAccounting] ${message.role} message.content 必须是字符串。`);
  }
  return message.content;
}

export function readFunctionToolCalls(message: LlmRequestMessage): readonly FunctionToolCall[] {
  if (message.role !== 'assistant' || !('tool_calls' in message)) return [];
  return message.tool_calls.map((value, index) => {
    if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.function)) {
      throw new Error(`[TokenAccounting] assistant.tool_calls[${index}] 缺少 id/function。`);
    }
    const fn = value.function;
    if (typeof fn.name !== 'string' || typeof fn.arguments !== 'string') {
      throw new Error(`[TokenAccounting] assistant.tool_calls[${index}] 缺少 name/arguments。`);
    }
    const parsed: unknown = JSON.parse(fn.arguments);
    if (!isRecord(parsed)) {
      throw new Error(
        `[TokenAccounting] assistant.tool_calls[${index}].arguments 必须是 JSON object。`
      );
    }
    return { id: value.id, name: fn.name, input: parsed };
  });
}

export function readFunctionToolDefinitions(value: unknown): readonly FunctionToolDefinition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error('[TokenAccounting] tools 必须是 function tool 数组。');
  }
  return value.map((tool, index) => {
    if (!isRecord(tool) || tool.type !== 'function' || !isRecord(tool.function)) {
      throw new Error(`[TokenAccounting] tools[${index}] 不是 function tool。`);
    }
    const fn = tool.function;
    if (typeof fn.name !== 'string' || !isRecord(fn.parameters)) {
      throw new Error(`[TokenAccounting] tools[${index}] 缺少 name/parameters。`);
    }
    if (fn.description !== undefined && typeof fn.description !== 'string') {
      throw new Error(`[TokenAccounting] tools[${index}].description 必须是字符串。`);
    }
    return {
      name: fn.name,
      ...(typeof fn.description === 'string' ? { description: fn.description } : {}),
      parameters: fn.parameters,
    };
  });
}

export function readToolCallId(message: LlmRequestMessage): string {
  if (message.role !== 'tool' || !('tool_call_id' in message) || !message.tool_call_id) {
    throw new Error('[TokenAccounting] tool message 缺少 tool_call_id。');
  }
  return message.tool_call_id;
}
