import {
  createToolCallDecisionEvent,
  type RuntimeEvent,
  type SerializableJsonRecord,
  type ToolCallDecisionEvent,
  ToolCallIdSchema,
} from '../../../contracts';
import type { StandardToolCall } from '../types';

export interface HostToolCallBootstrapInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly args: SerializableJsonRecord;
  readonly history?: readonly RuntimeEvent[];
  readonly timestamp?: number;
  readonly metadata?: SerializableJsonRecord;
  readonly decisionMeta?: SerializableJsonRecord;
  readonly parentToolCallId?: string;
}

export interface HostToolCallBootstrapLocalPatch {
  readonly conversationId: string;
  readonly turnId: string;
  readonly history: RuntimeEvent[];
  readonly pendingToolCalls: StandardToolCall[];
}

export interface HostToolCallBootstrap {
  readonly nodeId: 'tool';
  readonly toolCall: StandardToolCall;
  readonly decisionEvent: ToolCallDecisionEvent;
  readonly localPatch: HostToolCallBootstrapLocalPatch;
}

function requireIdentity(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`host tool bootstrap requires non-empty ${field}`);
  }
  return normalized;
}

/**
 * 为 host 主动发起的单次工具调用构造同源 Graph 起点。
 *
 * host 仍负责发布和持久化 decisionEvent，并将其它运行时 local 与 localPatch 合并后 prime GraphExecutor。
 */
export function createHostToolCallBootstrap(
  input: HostToolCallBootstrapInput
): HostToolCallBootstrap {
  const eventId = requireIdentity(input.eventId, 'eventId');
  const conversationId = requireIdentity(input.conversationId, 'conversationId');
  const turnId = requireIdentity(input.turnId, 'turnId');
  const toolName = requireIdentity(input.toolName, 'toolName');
  const toolCallId = ToolCallIdSchema.parse(input.toolCallId);
  if (input.timestamp !== undefined && !Number.isFinite(input.timestamp)) {
    throw new Error('host tool bootstrap requires a finite timestamp');
  }

  const args: SerializableJsonRecord = { ...input.args };
  const toolCall: StandardToolCall = {
    id: toolCallId,
    type: 'function',
    function: {
      name: toolName,
      arguments: JSON.stringify(args),
    },
  };
  const decisionEvent = createToolCallDecisionEvent(
    eventId,
    conversationId,
    turnId,
    toolName,
    toolCallId,
    {
      ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ...(input.parentToolCallId === undefined
        ? {}
        : { parent_tool_call_id: ToolCallIdSchema.parse(input.parentToolCallId) }),
      args,
      payload: {
        args,
        tool_calls: [
          {
            id: toolCall.id,
            type: toolCall.type,
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
          },
        ],
      },
      meta: {
        ...(input.decisionMeta ?? {}),
        primary_tool_call_id: toolCallId,
        tool_call_ids: [toolCallId],
        tool_batch_size: 1,
      },
    }
  );

  return {
    nodeId: 'tool',
    toolCall,
    decisionEvent,
    localPatch: {
      conversationId,
      turnId,
      history: [...(input.history ?? []), decisionEvent],
      pendingToolCalls: [toolCall],
    },
  };
}
