import { describe, expect, it, vi } from 'vitest';

import type { RoutedRuntimeEvent, RuntimeEvent } from '../../../contracts';
import type { EventStore, PersistedEvent } from '../../graph-engine/event-store/base';
import { EventBus } from '../event-bus';
import { EventSequencer } from '../sequencer';
import { EventBusEventPersistence } from '../eventBusEventPersistence';
import { RuntimeEventPublisher } from '../runtimeEventPublisher';
import { RunIdSchema } from '../../../contracts';

function answerEvent(id: string, content: string): RuntimeEvent {
  return {
    type: 'final_answer',
    id,
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    timestamp: 1,
    version: 1,
    answer_id: id,
    content,
    is_complete: true,
    completion_reason: 'terminal',
  };
}

function createSubject(append: (event: PersistedEvent) => Promise<void>) {
  const sequencer = new EventSequencer('conversation-1');
  const eventBus = new EventBus(sequencer.getExecutionId());
  const publisher = new RuntimeEventPublisher(eventBus, sequencer, {
    run_id: RunIdSchema.parse('run-1'),
    lane: 'foreground',
    visibility: 'conversation',
  });
  const eventStore: EventStore = {
    append,
    range: vi.fn(async () => []),
    latestEventStoreId: vi.fn(async () => null),
  };
  let cursor = 0;
  const persistence = new EventBusEventPersistence({
    eventBus,
    eventStore,
    nextEventStoreId: () => `event-store-${cursor++}`,
  });
  persistence.connect();
  return { eventBus, persistence, publisher };
}

describe('EventBusEventPersistence', () => {
  it('只把 durable facts 按 EventBus 顺序写入同一 EventStore', async () => {
    const writes: PersistedEvent[] = [];
    const subject = createSubject(async event => {
      writes.push(event);
    });

    subject.publisher.publish(answerEvent('answer-1', '第一段'), 'test');
    subject.publisher.publish(
      {
        type: 'final_answer_chunk',
        id: 'chunk-1',
        conversation_id: 'conversation-1',
        turn_id: 'turn-1',
        timestamp: 2,
        version: 1,
        ephemeral: true,
        answer_id: 'answer-2',
        seq: 0,
        content: '实时片段',
      },
      'test'
    );
    subject.publisher.publish(answerEvent('answer-2', '第二段'), 'test');

    await subject.persistence.drain();

    expect(writes.map(({ eventStoreId, event }) => ({ eventStoreId, id: event.id }))).toEqual([
      { eventStoreId: 'event-store-0', id: 'answer-1' },
      { eventStoreId: 'event-store-1', id: 'answer-2' },
    ]);
  });

  it('首个写入失败会阻止后续写入，并由 drain 传播给 lifecycle', async () => {
    const writes: RoutedRuntimeEvent[] = [];
    const failure = new Error('event store unavailable');
    const subject = createSubject(async ({ event }) => {
      writes.push(event);
      if (event.id === 'answer-1') throw failure;
    });

    subject.publisher.publish(answerEvent('answer-1', '第一段'), 'test');
    subject.publisher.publish(answerEvent('answer-2', '第二段'), 'test');

    await expect(subject.persistence.drain()).rejects.toBe(failure);
    expect(writes.map(event => event.id)).toEqual(['answer-1']);
  });

  it('admission transaction 已提交的事实只 fan-out，不重复落盘', async () => {
    const writes: PersistedEvent[] = [];
    const subject = createSubject(async event => {
      writes.push(event);
    });
    const committed = subject.publisher.route(answerEvent('answer-committed', '已提交'));
    subject.persistence.acknowledgePersisted([committed]);

    subject.publisher.publishRouted(committed, 'incoming', { recordInGeneratedJournal: false });
    await subject.persistence.drain();

    expect(writes).toEqual([]);
  });

  it('commit-before-publish 先等待落盘，随后 fan-out 也不重复写入', async () => {
    const writes: PersistedEvent[] = [];
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const subject = createSubject(async event => {
      writes.push(event);
      await writeGate;
    });
    const observed: string[] = [];
    subject.eventBus.on('event', envelope => observed.push(envelope.payload.id));
    const committed = subject.publisher.route(answerEvent('answer-precommitted', '先落盘'));

    const commit = subject.persistence.commitBeforePublish(committed);
    await Promise.resolve();
    expect(writes.map(item => item.event.id)).toEqual(['answer-precommitted']);
    expect(observed).toEqual([]);

    releaseWrite?.();
    await commit;
    subject.publisher.publishRouted(committed, 'durable');
    await subject.persistence.drain();

    expect(observed).toEqual(['answer-precommitted']);
    expect(writes.map(item => item.event.id)).toEqual(['answer-precommitted']);
  });
});
