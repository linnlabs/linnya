import { describe, expect, it } from 'vitest';

import { createMonotonicEventStoreIdFactory } from '../base';
import { MemoryEventStore } from '../memoryEventStore';
import type { PersistedEvent } from '../base';
import {
  createFinalAnswerChunkEvent,
  createToolProcessEvent,
  routeRuntimeEvent,
  type RoutedRuntimeEvent,
} from '../../../../contracts';

function createRuntimeEvent(id: string, conversationId: string, timestamp: number): RoutedRuntimeEvent {
  return routeRuntimeEvent({
    type: 'user_input',
    id,
    conversation_id: conversationId,
    timestamp,
    turn_id: `turn-${id}`,
    version: 1,
    content: `content-${id}`,
    source: 'user',
  }, {
    run_id: `run-${conversationId}`,
    lane: 'foreground',
    visibility: 'conversation',
  });
}

function createPersistedEvent(
  eventStoreId: string,
  conversationId: string,
  timestamp: number,
): PersistedEvent {
  return {
    eventStoreId,
    event: createRuntimeEvent(eventStoreId, conversationId, timestamp),
  };
}

describe('EventStore contract', () => {
  it('creates monotonic event ids', () => {
    const nextEventId = createMonotonicEventStoreIdFactory(() => 1_760_000_000_000);

    const first = nextEventId();
    const second = nextEventId();

    expect(first).not.toBe(second);
    expect(first < second).toBe(true);
  });

  it('keeps storage cursors monotonic when the system clock moves backwards', () => {
    const timestamps = [1_760_000_000_001, 1_760_000_000_000, 1_760_000_000_002];
    const nextEventId = createMonotonicEventStoreIdFactory(() => timestamps.shift() ?? 0);

    const cursors = [nextEventId(), nextEventId(), nextEventId()];

    expect(cursors).toEqual([
      '1760000000001-0000',
      '1760000000001-0001',
      '1760000000002-0000',
    ]);
  });

  it('appends and ranges events per conversation in append order', async () => {
    const store = new MemoryEventStore();

    await store.append(createPersistedEvent('evt-1', 'conv-1', 10));
    await store.append(createPersistedEvent('evt-2', 'conv-1', 20));
    await store.append(createPersistedEvent('evt-3', 'conv-2', 30));

    await expect(store.range('conv-1')).resolves.toEqual([
      createPersistedEvent('evt-1', 'conv-1', 10),
      createPersistedEvent('evt-2', 'conv-1', 20),
    ]);
    await expect(store.latestEventStoreId('conv-1')).resolves.toBe('evt-2');
  });

  it('truncates events before a cursor event id', async () => {
    const store = new MemoryEventStore();

    await store.append(createPersistedEvent('evt-1', 'conv-1', 10));
    await store.append(createPersistedEvent('evt-2', 'conv-1', 20));
    await store.append(createPersistedEvent('evt-3', 'conv-1', 30));

    await store.truncate?.('conv-1', { beforeEventStoreId: 'evt-3' });

    await expect(store.range('conv-1')).resolves.toEqual([
      createPersistedEvent('evt-3', 'conv-1', 30),
    ]);
  });

  it('isolates nested event snapshots on append and range', async () => {
    const store = new MemoryEventStore();
    const persisted: PersistedEvent = {
      eventStoreId: 'evt-nested',
      event: routeRuntimeEvent({
        type: 'tool_output',
        id: 'tool-output-1',
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        timestamp: 10,
        version: 1,
        tool_name: 'lookup',
        tool_call_id: 'call-1',
        status: 'success',
        observation: 'before',
        data: { nested: { value: 'before' } },
        metadata: {
          observationTruncation: {
            blobId: 'blob_1',
            originalChars: 20,
            previewChars: 10,
          },
        },
      }, {
        run_id: 'run-conv-1',
        lane: 'foreground',
        visibility: 'conversation',
      }),
    };

    await store.append(persisted);
    if (persisted.event.type !== 'tool_output') {
      throw new Error('test fixture must be tool_output');
    }
    persisted.event.data = { nested: { value: 'mutated-after-append' } };

    const firstRange = await store.range('conv-1');
    const firstEvent = firstRange[0]?.event;
    expect(firstEvent?.type).toBe('tool_output');
    expect(firstEvent?.type === 'tool_output' ? firstEvent.data : undefined).toEqual({
      nested: { value: 'before' },
    });

    firstRange[0].event.metadata = {
      observationTruncation: {
        blobId: 'mutated_blob',
        originalChars: 999,
        previewChars: 10,
      },
    };

    const secondRange = await store.range('conv-1');
    expect(secondRange[0]?.event.metadata).toEqual({
      observationTruncation: {
        blobId: 'blob_1',
        originalChars: 20,
        previewChars: 10,
      },
    });
  });

  it('rejects realtime progress at the durable EventStore boundary', async () => {
    const store = new MemoryEventStore();
    const identity = {
      run_id: 'run-1',
      lane: 'foreground' as const,
      visibility: 'conversation' as const,
    };
    const chunk = routeRuntimeEvent(
      createFinalAnswerChunkEvent('chunk-1', 'conv-1', 'turn-1', 'answer-1', 0, 'draft', {
        ephemeral: true,
      }),
      identity,
    );
    const toolProcess = routeRuntimeEvent(
      createToolProcessEvent('process-1', 'conv-1', 'turn-1', 'lookup', 'call-1', {
        phase: 'update',
        status: 'loading',
      }),
      identity,
    );

    await expect(store.append({ eventStoreId: 'cursor-1', event: chunk }))
      .rejects.toThrow('is not eligible for persistence');
    await expect(store.append({ eventStoreId: 'cursor-2', event: toolProcess }))
      .rejects.toThrow('is not eligible for persistence');
    await expect(store.range('conv-1')).resolves.toEqual([]);
  });
});
