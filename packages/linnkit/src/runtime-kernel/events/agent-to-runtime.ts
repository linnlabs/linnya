import {
  AgentEventSchema,
  type ObservationEvent as AgentObservationEvent,
  type StreamChunkEvent as AgentStreamChunkEvent,
  type ThoughtEvent as AgentThoughtEvent,
  type ToolCallDecisionEvent as AgentToolCallDecisionEvent,
  type ToolProcessEvent as AgentToolProcessEvent,
} from './agentEvents';
import {
  RuntimeEvent,
  createErrorEvent,
  createFinalAnswerChunkEvent,
  createFinalAnswerEvent,
  createFinalAnswerResetEvent,
  createThoughtEvent,
  createToolCallDecisionEvent,
  createToolOutputEvent,
  createToolProcessEvent,
  RuntimeEventIdSchema,
  toSerializableJsonRecord,
  toSerializableJsonValue,
} from '../../contracts';
import {
  type EventMappingContext,
  type RuntimeMappingOptions,
  isRecord,
  readMetaFromEvent,
} from './provider-sidecar';

export function agentEventToRuntime(
  agentEvent: unknown,
  context: EventMappingContext,
  options: RuntimeMappingOptions = {},
): RuntimeEvent | null {
  return mapAgentEventToRuntime(agentEvent, context, options);
}

function mapAgentEventToRuntime(
  agentEvent: unknown,
  context: EventMappingContext,
  options: RuntimeMappingOptions,
): RuntimeEvent | null {
  if (isRecord(agentEvent) && agentEvent['type'] === 'history_summary') {
    const event = RuntimeEvent.parse(agentEvent);
    return context.metadata
      ? {
          ...event,
          metadata: toSerializableJsonRecord({ ...(event.metadata ?? {}), ...context.metadata }),
        }
      : event;
  }

  const parsed = AgentEventSchema.safeParse(agentEvent);
  if (!parsed.success) {
    throw new Error(`Invalid AgentEvent: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  const typed = parsed.data;
  const { conversationId, turnId } = context;
  const timestamp = requireEventTimestamp(typed.timestamp);
  const id = RuntimeEventIdSchema.parse(typed.id);
  const contextMeta = toSerializableJsonRecord(context.metadata);

  switch (typed.type) {
    case 'thought':
      return mapThoughtToRuntime(typed, context, options, id, timestamp);

    case 'tool_call_decision':
    case 'tool_process':
      return mapToolProgressToRuntime(typed, context, options, id, timestamp);

    case 'observation': {
      const observationEvent = typed;
      const toolName = observationEvent.tool_name;
      const toolCallId = observationEvent.tool_call_id;
      const event = createToolOutputEvent(
        id,
        conversationId,
        turnId,
        toolName,
        toolCallId,
        observationEvent.success
          ? {
              status: 'success',
              observation: observationEvent.observation,
              data: observationEvent.data,
            }
          : {
              status: 'error',
              observation: observationEvent.observation,
              error: observationEvent.error ?? observationEvent.observation,
              ...(observationEvent.error_code === undefined
                ? {}
                : { error_code: observationEvent.error_code }),
            },
        {
          timestamp,
          duration_ms: observationEvent.duration_ms,
          ...(observationEvent.attachments ? { attachments: [...observationEvent.attachments] } : {}),
        },
      );
      event.ephemeral = false;
      if (contextMeta) event.metadata = { ...(event.metadata ?? {}), ...contextMeta };
      return event;
    }

    case 'final_answer': {
      const finalAnswerEvent = typed;
      const event = createFinalAnswerEvent(
        finalAnswerEvent.answer_id,
        conversationId,
        turnId,
        finalAnswerEvent.answer,
        {
          timestamp,
          completion_reason: finalAnswerEvent.completion_reason,
          provider_continuations: finalAnswerEvent.provider_continuations,
          assistant_replay_parts: finalAnswerEvent.assistant_replay_parts,
          meta: toSerializableJsonRecord(readMetaFromEvent(finalAnswerEvent)),
        },
      );
      if (contextMeta) event.metadata = { ...(event.metadata ?? {}), ...contextMeta };
      return event;
    }

    case 'error': {
      const errorEvent = typed;
      const event = createErrorEvent(id, conversationId, turnId, errorEvent.error, {
        timestamp,
        details: toSerializableJsonValue(errorEvent.details),
        error_code: errorEvent.error_code,
        retryable: errorEvent.retryable,
      });
      if (contextMeta) event.metadata = { ...(event.metadata ?? {}), ...contextMeta };
      return event;
    }

    case 'stream_chunk':
      return mapStreamChunkToRuntime(typed, context, id, timestamp);

    case 'stream_reset': {
      const resetEvent = typed;
      const event = createFinalAnswerResetEvent(id, conversationId, turnId, {
        timestamp,
        answer_id: resetEvent.answer_id,
        thought_message_ids: resetEvent.thought_message_ids,
      });
      if (contextMeta) event.metadata = { ...(event.metadata ?? {}), ...contextMeta };
      return event;
    }

    default:
      return null;
  }
}

function mapThoughtToRuntime(
  thoughtEvent: AgentThoughtEvent,
  context: EventMappingContext,
  options: RuntimeMappingOptions,
  id: string,
  timestamp: number,
): RuntimeEvent | null {
  const isComplete = thoughtEvent.is_complete;
  if (options.skipIncomplete && !isComplete) return null;

  const runtimeEvent = createThoughtEvent(id, context.conversationId, context.turnId, thoughtEvent.content, {
    timestamp,
    thought_message_id: thoughtEvent.thought_message_id,
    delta: thoughtEvent.delta,
    is_complete: isComplete,
  });
  if (!isComplete) runtimeEvent.ephemeral = true;
  const thoughtMeta = toSerializableJsonRecord(thoughtEvent.meta);
  if (context.metadata || thoughtMeta) {
    runtimeEvent.metadata = toSerializableJsonRecord({
      ...(runtimeEvent.metadata ?? {}),
      ...(context.metadata ?? {}),
      ...(thoughtMeta ?? {}),
    });
  }
  return runtimeEvent;
}

function mapToolProgressToRuntime(
  toolEvent: AgentToolCallDecisionEvent | AgentToolProcessEvent,
  context: EventMappingContext,
  options: RuntimeMappingOptions,
  id: string,
  timestamp: number,
): RuntimeEvent {
  const toolName = toolEvent.tool_name;
  const toolCallId = toolEvent.tool_call_id;
  const meta = toSerializableJsonRecord(toolEvent.meta) ?? {};
  const event = toolEvent.type === 'tool_call_decision'
    ? createToolCallDecisionEvent(id, context.conversationId, context.turnId, toolName, toolCallId, {
        timestamp,
        phase: toolEvent.phase,
        status: toolEvent.status,
        args: toSerializableJsonRecord(toolEvent.tool_args) ?? {},
        payload: toSerializableJsonRecord(toolEvent.payload) ?? {},
        meta,
      })
    : createToolProcessEvent(id, context.conversationId, context.turnId, toolName, toolCallId, {
        timestamp,
        phase: toolEvent.phase,
        status: toolEvent.status,
        args: toSerializableJsonRecord(toolEvent.tool_args) ?? {},
        payload: toSerializableJsonRecord(toolEvent.payload) ?? {},
        meta,
      });
  event.ephemeral = meta.ephemeral === true;
  if (context.metadata) event.metadata = toSerializableJsonRecord({ ...(event.metadata ?? {}), ...context.metadata });
  return event;
}

function mapStreamChunkToRuntime(
  streamEvent: AgentStreamChunkEvent,
  context: EventMappingContext,
  id: string,
  timestamp: number,
): RuntimeEvent | null {
  const text = streamEvent.content ?? '';
  if (!text) return null;
  const chunkEvent = createFinalAnswerChunkEvent(id, context.conversationId, context.turnId, streamEvent.answer_id, streamEvent.seq, text, {
    timestamp,
    is_last: streamEvent.is_last === true,
  });
  chunkEvent.ephemeral = true;
  if (context.metadata) {
    chunkEvent.metadata = toSerializableJsonRecord({ ...(chunkEvent.metadata ?? {}), ...context.metadata });
  }
  return chunkEvent;
}

function requireEventTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Agent event requires a finite timestamp from its fact creator.');
  }
  return value;
}
