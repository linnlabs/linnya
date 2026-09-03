import {
  createAuditEnvelopeEvent,
  generateRuntimeEventId,
  routeRuntimeEvent,
} from '../../contracts';
import type { AuditEnvelope } from '../../contracts';
import type { AuditPort } from '../../ports';
import type { EventStore } from '../graph-engine/event-store/base';

export interface EventStoreAuditOptions {
  eventStore: EventStore;
}

export class AuditEnvelopePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditEnvelopePersistenceError';
  }
}

function resolveConversationId(envelope: AuditEnvelope): string {
  const conversationId = envelope.scope?.conversationId;
  if (typeof conversationId === 'string' && conversationId.trim().length > 0) {
    return conversationId;
  }
  throw new AuditEnvelopePersistenceError(
    `AuditEnvelope ${envelope.envelopeId} cannot be persisted without scope.conversationId`,
  );
}

function resolveTurnId(envelope: AuditEnvelope): string {
  const turnId = envelope.scope?.turnId;
  if (typeof turnId === 'string' && turnId.trim().length > 0) {
    return turnId;
  }
  return envelope.runId;
}

/**
 * 默认 EventStore 审计 sink。
 *
 * 中文备注：
 * - 写入隐藏 RuntimeEvent：type=audit_envelope；
 * - 事件不进 UI、不进 agent context，只作为追加只读审计事实保留；
 * - conversationId 必须来自 envelope.scope，避免把跨会话审计混进同一条流。
 */
export class EventStoreAuditPort implements AuditPort {
  private readonly eventStore: EventStore;

  constructor(options: EventStoreAuditOptions) {
    this.eventStore = options.eventStore;
  }

  async emit(envelope: AuditEnvelope): Promise<void> {
    const conversationId = resolveConversationId(envelope);
    const turnId = resolveTurnId(envelope);
    const event = routeRuntimeEvent(
      createAuditEnvelopeEvent(
        generateRuntimeEventId(),
        conversationId,
        turnId,
        envelope,
      ),
      {
        run_id: envelope.runId,
        parent_run_id: envelope.parentRunId,
        // Audit 是目标 run 的隐藏辅助事实，不属于该 run 的正文展示 lane。
        lane: 'auxiliary',
        visibility: 'none',
      },
    );

    await this.eventStore.append({
      eventStoreId: event.id,
      event,
    });
  }
}

export function createEventStoreAudit(options: EventStoreAuditOptions): AuditPort {
  return new EventStoreAuditPort(options);
}
