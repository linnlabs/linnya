import { describe, expect, it } from 'vitest';
import {
  createUserInputEvent,
  routeRuntimeEvent,
} from '@linnlabs/linnkit/contracts';

import {
  parseStoredRuntimeEvent,
  serializeStoredRuntimeEvent,
} from '../functions/runtimeEventStorageCodec';

function createStoredEvent() {
  return routeRuntimeEvent(
    createUserInputEvent(
      'event-storage-codec',
      'conversation-storage-codec',
      'turn-storage-codec',
      'body only',
      { timestamp: 123 },
    ),
    {
      run_id: 'run-storage-codec',
      parent_run_id: 'parent-storage-codec',
      lane: 'child',
      visibility: 'parent-trace',
    },
  );
}

describe('RuntimeEvent SQLite storage codec', () => {
  it('只在 payload 保存事件 body，并由 SQLite 身份完整重建事实', () => {
    const event = createStoredEvent();
    const payload = serializeStoredRuntimeEvent(event);

    expect(JSON.parse(payload)).toEqual({
      content: 'body only',
      source: 'user',
      version: 1,
      turn_id: 'turn-storage-codec',
      lane: 'child',
      visibility: 'parent-trace',
    });
    expect(parseStoredRuntimeEvent(payload, {
      eventId: event.id,
      eventType: event.type,
      conversationId: event.conversation_id,
      runId: event.run_id,
      parentRunId: event.parent_run_id ?? null,
      timestamp: event.timestamp,
    })).toEqual(event);
  });

  it.each([
    'id',
    'type',
    'conversation_id',
    'run_id',
    'parent_run_id',
    'timestamp',
  ])('拒绝 payload 重新复制身份字段 %s', (identityField) => {
    expect(() => parseStoredRuntimeEvent(
      JSON.stringify({
        content: 'body only',
        source: 'user',
        version: 1,
        turn_id: 'turn-storage-codec',
        lane: 'child',
        visibility: 'parent-trace',
        [identityField]: 'duplicated',
      }),
      {
        eventId: 'event-storage-codec',
        eventType: 'user_input',
        conversationId: 'conversation-storage-codec',
        runId: 'run-storage-codec',
        parentRunId: 'parent-storage-codec',
        timestamp: 123,
      },
    )).toThrow(`must not contain identity field ${identityField}`);
  });

  it('拒绝无法通过正式 RuntimeEvent schema 的 body', () => {
    expect(() => parseStoredRuntimeEvent(
      JSON.stringify({
        source: 'user',
        version: 1,
        turn_id: 'turn-storage-codec',
        lane: 'foreground',
        visibility: 'conversation',
      }),
      {
        eventId: 'event-storage-codec',
        eventType: 'user_input',
        conversationId: 'conversation-storage-codec',
        runId: 'run-storage-codec',
        parentRunId: null,
        timestamp: 123,
      },
    )).toThrow();
  });
});
