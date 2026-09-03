import type {
  ToolProtocolErrorAuditEntry,
  ToolProtocolErrorReplayInput,
} from '../definitions/llmRunAudit';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function buildRawArgumentsSummary(rawArguments: string): {
  length: number;
  head: string;
  tail: string;
} {
  const previewChars = 160;
  return {
    length: rawArguments.length,
    head: rawArguments.slice(0, previewChars),
    tail: rawArguments.slice(Math.max(0, rawArguments.length - previewChars)),
  };
}

export function cloneAuditValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }
}

export function buildToolProtocolReplayInput(
  entries: readonly ToolProtocolErrorAuditEntry[],
): ToolProtocolErrorReplayInput[] {
  return entries.map((entry, index) => ({
    fixtureId: `${entry.audit_context?.runId ?? 'run'}:${entry.payload.tool_call.toolName}:${entry.payload.tool_call.toolCallId ?? index}`,
    audit_context: cloneAuditValue(entry.audit_context),
    toolName: entry.payload.tool_call.toolName,
    ...(typeof entry.payload.tool_call.toolCallId === 'string'
      ? { toolCallId: entry.payload.tool_call.toolCallId }
      : {}),
    messages: Array.isArray(entry.payload.llm_request.llmMessages)
      ? cloneAuditValue(entry.payload.llm_request.llmMessages)
      : [],
    ...(Array.isArray(entry.payload.llm_request.contextMessages)
      ? { contextMessages: cloneAuditValue(entry.payload.llm_request.contextMessages) }
      : {}),
    ...(Array.isArray(entry.payload.llm_request.tool_names)
      ? { tool_names: cloneAuditValue(entry.payload.llm_request.tool_names) }
      : {}),
    expected_error: entry.payload.protocol_error.message,
    original_tool_call: {
      ...(typeof entry.payload.tool_call.rawArguments === 'string'
        ? { rawArguments: entry.payload.tool_call.rawArguments }
        : {}),
      ...(entry.payload.tool_call.rawArgumentsSummary
        ? { rawArgumentsSummary: cloneAuditValue(entry.payload.tool_call.rawArgumentsSummary) }
        : {}),
      ...(entry.payload.tool_call.parsedArguments
        ? { parsedArguments: cloneAuditValue(entry.payload.tool_call.parsedArguments) }
        : {}),
    },
  }));
}
