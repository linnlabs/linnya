import type {
  ObservationEvent as AgentObservationEvent,
  ToolProcessEvent as AgentToolProcessEvent,
} from '../../events/agentEvents';
import { eventMapper, type EventMappingContext } from '../../events/eventMappers';
import { generateAnswerSegmentId, generateRuntimeEventId } from '../../../contracts';
import { Logger } from '../../../shared/logger';
import type {
  RoutedRuntimeEvent,
  RuntimeEvent,
  RuntimeResourceRef,
  SerializableJsonRecord,
  ToolCallId,
  ToolOutputEventResult,
} from '../../../contracts';
import type { RuntimeEventSink } from '../types';
import { createStandaloneFinalAnswerChunk } from '../../events/finalAnswerAssembler';

const logger = new Logger('ToolNode');

export interface ToolNodeEventBridgeDeps {
  runtimeEventSink: RuntimeEventSink;
  conversationId: string;
  turnId: string;
  toolName: string;
  toolCallId: ToolCallId;
  toolArgs: Record<string, unknown>;
  idempotencyKey?: string;
}

/** ToolNode 事实创建边界：每个事件只映射一次，同一对象同时发布并进入 journal。 */
export class ToolNodeEventBridge {
  private readonly runtimeEvents: RoutedRuntimeEvent[] = [];

  constructor(private readonly deps: ToolNodeEventBridgeDeps) {}

  emitToolProcess(
    phase: 'start' | 'update' | 'complete' | 'error',
    status: 'loading' | 'success' | 'error',
    payload: Record<string, unknown>
  ): RuntimeEvent {
    const id = generateRuntimeEventId();
    const timestamp = Date.now();
    const agentEvent: AgentToolProcessEvent = {
      type: 'tool_process',
      id,
      timestamp,
      tool_name: this.deps.toolName,
      tool_args: this.readToolArgs(payload),
      ...(Array.isArray(payload.tool_calls) ? { tool_calls: payload.tool_calls } : {}),
      tool_call_id: this.deps.toolCallId,
      phase,
      status,
      payload: { ...payload },
    };

    logger.info('[ToolNode] 发出 tool_process 事件', {
      phase,
      status,
      toolName: this.deps.toolName,
      toolCallId: this.deps.toolCallId,
      eventId: id,
      conversationId: this.deps.conversationId,
      turnId: this.deps.turnId,
    });
    return this.mapPublishAndBuffer(agentEvent, `ToolNode.tool_process.${phase}`);
  }

  emitToolOutput(
    result: ToolOutputEventResult,
    options: {
      attachments?: readonly RuntimeResourceRef[];
      metadata?: SerializableJsonRecord;
      ephemeral?: boolean;
      durationMs?: number;
    } = {}
  ): RuntimeEvent {
    const id = generateRuntimeEventId();
    const timestamp = Date.now();
    const agentEvent: AgentObservationEvent = {
      type: 'observation',
      id,
      timestamp,
      tool_name: this.deps.toolName,
      tool_call_id: this.deps.toolCallId,
      observation: result.observation,
      success: result.status === 'success',
      ...(result.status === 'success' ? { data: result.data } : { error: result.error }),
      ...(result.status === 'error' && result.error_code !== undefined
        ? { error_code: result.error_code }
        : {}),
      duration_ms: options.durationMs,
      ...(options.attachments ? { attachments: [...options.attachments] } : {}),
    };

    const runtimeEvent = this.mapRuntimeEvent(agentEvent);
    const metadata: SerializableJsonRecord = {
      ...(runtimeEvent.metadata ?? {}),
      ...(options.metadata ?? {}),
    };
    if (Object.keys(metadata).length > 0) runtimeEvent.metadata = metadata;
    if (options.ephemeral) runtimeEvent.ephemeral = true;
    return this.publishAndBuffer(runtimeEvent, 'ToolNode.tool_output');
  }

  emitFinalAnswer(params: { answer: string; sourceToolName: string }): RuntimeEvent {
    const answerId = generateAnswerSegmentId();
    const id = answerId;
    const timestamp = Date.now();
    logger.info('[ToolNode] 工具输出映射为 final_answer', {
      sourceToolName: params.sourceToolName,
      toolCallId: this.deps.toolCallId,
      conversationId: this.deps.conversationId,
      turnId: this.deps.turnId,
      answerChars: params.answer.length,
    });
    const finalAnswer = this.mapRuntimeEvent({
      type: 'final_answer',
      id,
      timestamp,
      answer: params.answer,
      answer_id: answerId,
      completion_reason: 'terminal',
    });
    if (finalAnswer.type !== 'final_answer') {
      throw new Error('ToolNode final answer did not map to final_answer.');
    }
    this.publishAndBuffer(
      createStandaloneFinalAnswerChunk(finalAnswer),
      'ToolNode.final_answer_chunk.standalone'
    );
    return this.publishAndBuffer(finalAnswer, 'ToolNode.final_answer');
  }

  getRuntimeEvents(): RoutedRuntimeEvent[] {
    return [...this.runtimeEvents];
  }

  private mapPublishAndBuffer(
    event:
      | AgentToolProcessEvent
      | AgentObservationEvent
      | {
          type: 'final_answer';
          id: string;
          timestamp: number;
          answer: string;
          answer_id: string;
          completion_reason: 'terminal';
        },
    source: string
  ): RuntimeEvent {
    return this.publishAndBuffer(this.mapRuntimeEvent(event), source);
  }

  private mapRuntimeEvent(
    event:
      | AgentToolProcessEvent
      | AgentObservationEvent
      | {
          type: 'final_answer';
          id: string;
          timestamp: number;
          answer: string;
          answer_id: string;
          completion_reason: 'terminal';
        }
  ): RuntimeEvent {
    const runtime = eventMapper.agentToRuntime(event, this.getMappingContext(), {
      skipIncomplete: false,
    });
    if (!runtime) {
      throw new Error(`ToolNode event did not map to RuntimeEvent: ${event.type}`);
    }
    return runtime;
  }

  private publishAndBuffer(event: RuntimeEvent, source: string): RoutedRuntimeEvent {
    const published = this.deps.runtimeEventSink(event, source);
    this.runtimeEvents.push(published);
    return published;
  }

  private getMappingContext(): EventMappingContext {
    return {
      conversationId: this.deps.conversationId,
      turnId: this.deps.turnId,
      metadata: this.deps.idempotencyKey
        ? { idempotency: { key: this.deps.idempotencyKey } }
        : undefined,
    };
  }

  private readToolArgs(payload: Record<string, unknown>): Record<string, unknown> {
    const maybeArgs = payload.args;
    return maybeArgs && typeof maybeArgs === 'object' && !Array.isArray(maybeArgs)
      ? (maybeArgs as Record<string, unknown>)
      : this.deps.toolArgs;
  }

}
