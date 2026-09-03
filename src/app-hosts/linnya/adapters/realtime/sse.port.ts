/**
 * @file src/app-hosts/linnya/adapters/realtime/sse.port.ts
 * @description SSE 端口 - 监听事件总线并推送给前端
 *
 * 功能 (What):
 * - 订阅 EventBus 的 'event' 事件。
 * - 将 EventEnvelope 转换为前端需要的 SSEEvent 格式。
 * - 通过 SSE (Server-Sent Events) sink 函数将事件推送给客户端。
 * - 这是 host realtime adapter 的默认实现。
 */

import { events } from 'linnkit/runtime-kernel';
import type { execution } from 'linnkit/runtime-kernel';
import { Logger } from 'src/shared/logger';
import type {
  EventEnvelope,
  RoutedRuntimeEvent,
  SSEEvent,
  SerializableJsonRecord,
} from 'linnkit/contracts';
import { runtimeEventToSSEEvent, toSerializableJsonRecord } from 'linnkit/contracts';

const logger = new Logger('SsePort');

export type SseEventSink = (event: SSEEvent) => void;

export interface RuntimeEventSseMapper {
  mapToSse(envelope: EventEnvelope<RoutedRuntimeEvent>): SSEEvent[] | null;
}

export interface SsePortDependencies {
  sink: SseEventSink;
  runtimeEventMapper?: RuntimeEventSseMapper;
}

function isSsePortDependencies(value: unknown): value is SsePortDependencies {
  return !!value && typeof value === 'object' && typeof (value as SsePortDependencies).sink === 'function';
}

/**
 * RuntimeEvent -> SSEEvent 的默认宿主映射器。
 *
 * 中文备注：
 * - 生命周期治理仍以 `eventGovernance` 为权威；
 * - 这里只拥有“如何把允许实时发送的 RuntimeEvent 映射成宿主 SSEEvent”的职责；
 * - 后续若切到 WebSocket/IPC，可替换 mapper 或替换整个 realtime adapter，而不用回改 runtime。
 */
export class DefaultRuntimeEventSseMapper implements RuntimeEventSseMapper {
  mapToSse(envelope: EventEnvelope<RoutedRuntimeEvent>): SSEEvent[] | null {
    const { payload, render_hint } = envelope;
    const runtimeEvent = payload;

    if (!events.shouldEmitRuntimeEventToSse(runtimeEvent)) {
      return null;
    }

    const sseEvent = runtimeEventToSSEEvent(runtimeEvent);
    if (!sseEvent) {
      return null;
    }

    sseEvent.execution_id = envelope.trace.execution_id;
    sseEvent.execution_seq = envelope.seq;
    enrichSseWithRenderHint(sseEvent, render_hint);
    logRuntimeErrorEventInDev(sseEvent, envelope);
    return [sseEvent];
  }
}

function enrichSseWithRenderHint(
  sseEvent: SSEEvent,
  renderHint: EventEnvelope<RoutedRuntimeEvent>['render_hint'],
): void {
  if (!renderHint) {
    if (sseEvent.type === 'final_answer') {
      sseEvent.meta = { ...(sseEvent.meta ?? {}), stream_completed: true };
    }
    return;
  }

  const serializableRenderHint = toSerializableJsonRecord(renderHint);
  if (!serializableRenderHint) {
    return;
  }

  if (sseEvent.type === 'tool_call_decision' || sseEvent.type === 'tool_process') {
    sseEvent.meta = mergeSseMeta(sseEvent.meta, {
      render_hint: serializableRenderHint,
    });
  }

  if (sseEvent.type === 'final_answer') {
    sseEvent.meta = mergeSseMeta(sseEvent.meta, {
      render_hint: serializableRenderHint,
      stream_completed: true,
    });
  }
}

function mergeSseMeta(
  current: SerializableJsonRecord | undefined,
  patch: SerializableJsonRecord,
): SerializableJsonRecord {
  return { ...(current ?? {}), ...patch };
}

function logRuntimeErrorEventInDev(
  sseEvent: SSEEvent,
  envelope: EventEnvelope<RoutedRuntimeEvent>,
): void {
  const runtimeEvent = envelope.payload;
  if (
    sseEvent.type !== 'error'
    || runtimeEvent.type !== 'error'
    || process.env.NODE_ENV === 'production'
  ) {
    return;
  }

  logger.warn('[SsePort] Emitting SSE error event', {
    eventId: runtimeEvent.id,
    conversationId: runtimeEvent.conversation_id,
    turnId: runtimeEvent.turn_id,
    errorMessage: runtimeEvent.error,
    errorCode: runtimeEvent.error_code,
    detailsType: typeof runtimeEvent.details,
    sourceHint: envelope.source,
    seq: envelope.seq,
    runtimeEventKeys: Object.keys(runtimeEvent),
  });
}

export function createDefaultRuntimeEventSseMapper(): RuntimeEventSseMapper {
  return new DefaultRuntimeEventSseMapper();
}

/**
 * SSE 端口类
 *
 * 职责：将内部事件可靠地、格式正确地推送给前端。
 * 统一架构：SsePort 是 runtime event 到当前宿主 SSE 的默认 realtime adapter。
 */
export class SsePort {
  private readonly sink: SseEventSink;
  private readonly runtimeEventMapper: RuntimeEventSseMapper;

  constructor(sink: SseEventSink);
  constructor(dependencies: SsePortDependencies);
  constructor(sinkOrDependencies: SseEventSink | SsePortDependencies) {
    const dependencies = isSsePortDependencies(sinkOrDependencies)
      ? sinkOrDependencies
      : { sink: sinkOrDependencies };

    if (typeof dependencies.sink !== 'function') {
      throw new Error('SsePort requires a valid sink function.');
    }

    this.sink = dependencies.sink;
    this.runtimeEventMapper =
      dependencies.runtimeEventMapper ?? createDefaultRuntimeEventSseMapper();
    logger.info('SsePort initialized');
  }

  connect(eventBus: execution.EventBus): void {
    const executionId = eventBus.executionId;
    logger.info(`SsePort connecting to EventBus for execution ${executionId}`);

    const handleEvent = this.handleEvent.bind(this);

    eventBus.on('event', handleEvent);

    eventBus.once('close', () => {
      logger.info(`SsePort disconnecting from EventBus for execution ${executionId}`);
      eventBus.off('event', handleEvent);
    });
  }

  private handleEvent(envelope: EventEnvelope<RoutedRuntimeEvent>): void {
    try {
      const sseEvents = this.runtimeEventMapper.mapToSse(envelope);

      if (sseEvents) {
        for (const sseEvent of sseEvents) {
          this.sink(sseEvent);
        }
      }
    } catch (error) {
      logger.error('Failed to process or send SSE event', {
        error,
        executionId: envelope.trace.execution_id,
        seq: envelope.seq,
      });
    }
  }
}
