import { parseRoutedRuntimeEvent, type RoutedRuntimeEvent } from 'linnkit/contracts';
import { events as runtimeEvents } from 'linnkit/runtime-kernel';

export interface StoredRuntimeEventIdentity {
  readonly eventId: string;
  readonly eventType: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly parentRunId: string | null;
  readonly timestamp: number;
}

const STORED_IDENTITY_KEYS = [
  'id',
  'type',
  'conversation_id',
  'run_id',
  'parent_run_id',
  'timestamp',
] as const;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * SQLite 的关系列是持久化身份的唯一 owner，payload 只保存事件专属字段。
 *
 * 这些字段不能同时落入 payload，否则每条事件都会重复保存相同身份；读取端也会
 * 重新面临“列与 JSON 谁才是真的”这一不必要的双真源问题。
 */
export function serializeStoredRuntimeEvent(event: RoutedRuntimeEvent): string {
  runtimeEvents.requirePersistableRoutedRuntimeEvent(event);
  const {
    id: _eventId,
    type: _eventType,
    conversation_id: _conversationId,
    run_id: _runId,
    parent_run_id: _parentRunId,
    timestamp: _timestamp,
    ...body
  } = event;

  return JSON.stringify(body);
}

/**
 * 用 SQLite 行身份和 payload body 重建正式 RuntimeEvent。
 *
 * body 中出现任一身份字段都代表写入方绕开了 codec。这里必须直接失败，不能用
 * 行值覆盖后继续读取，否则完整 payload 会悄悄重新进入事实表。
 */
export function parseStoredRuntimeEvent(
  payload: string,
  identity: StoredRuntimeEventIdentity,
): RoutedRuntimeEvent {
  const body: unknown = JSON.parse(payload);
  if (!isJsonObject(body)) {
    throw new Error(
      `[SQLiteEventStore] stored event ${identity.eventId} payload must be a JSON object`,
    );
  }

  for (const key of STORED_IDENTITY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      throw new Error(
        `[SQLiteEventStore] stored event ${identity.eventId} payload must not contain identity field ${key}`,
      );
    }
  }

  return runtimeEvents.requirePersistableRoutedRuntimeEvent(
    parseRoutedRuntimeEvent({
      ...body,
      id: identity.eventId,
      type: identity.eventType,
      conversation_id: identity.conversationId,
      run_id: identity.runId,
      ...(identity.parentRunId === null ? {} : { parent_run_id: identity.parentRunId }),
      timestamp: identity.timestamp,
    }),
  );
}
