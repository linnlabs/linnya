import { describe, expect, it, vi } from 'vitest';
import {
  createFinalAnswerEvent,
  createRunExecutionMetricsEvent,
  RunIdSchema,
} from '../../../contracts';
import { EventBus, EventSequencer, RuntimeEventPublisher } from '../../execution';
import { ChildRunParentTraceProjection } from '../childRunParentTraceProjection';

function createChildExecution() {
  const sequencer = new EventSequencer('conversation-child-projection');
  const eventBus = new EventBus(sequencer.getExecutionId());
  const publisher = new RuntimeEventPublisher(eventBus, sequencer, {
    run_id: RunIdSchema.parse('child-run-1'),
    parent_run_id: RunIdSchema.parse('parent-run-1'),
    lane: 'child',
    visibility: 'parent-trace',
  });
  return { eventBus, publisher };
}

describe('ChildRunParentTraceProjection', () => {
  it('从 child EventBus 对每个正式 source fact 只投影一次，并过滤 child 控制事实', async () => {
    const { eventBus, publisher } = createChildExecution();
    const publishTrace = vi.fn();
    const projection = new ChildRunParentTraceProjection({
      childEventBus: eventBus,
      parentTracePublisher: { publish: publishTrace },
    });
    projection.connect();

    publisher.publish(
      createFinalAnswerEvent(
        'answer-shared',
        'conversation-child-projection',
        'turn-child-1',
        '第一段',
        { completion_reason: 'terminal' }
      ),
      'child:test'
    );
    publisher.publish(
      createFinalAnswerEvent(
        'answer-shared-2',
        'conversation-child-projection',
        'turn-child-1',
        '第二段',
        { completion_reason: 'terminal' }
      ),
      'child:test'
    );
    publisher.publish(
      createRunExecutionMetricsEvent(
        'child-metrics-event',
        'conversation-child-projection',
        'turn-child-1',
        {
          execution_id: 'child-execution-1',
          outcome: 'completed',
          duration_ms: 10,
          user_message_id: 'child-user-1',
        }
      ),
      'child:test'
    );
    await projection.drain();

    expect(publishTrace).toHaveBeenCalledTimes(2);
    expect(publishTrace.mock.calls.map(([trace]) => trace)).toEqual([
      expect.objectContaining({
        source_event_id: 'answer-shared',
        answer_id: 'answer-shared',
        content: '第一段',
      }),
      expect.objectContaining({
        source_event_id: 'answer-shared-2',
        answer_id: 'answer-shared-2',
        content: '第二段',
      }),
    ]);
  });

  it('记录父投影失败并在 terminal drain 传播，不中断 child EventBus 的其他 consumer', async () => {
    const { eventBus, publisher } = createChildExecution();
    const observedChildFacts: string[] = [];
    eventBus.on('event', envelope => observedChildFacts.push(envelope.payload.id));
    const projectionError = new Error('parent trace unavailable');
    const projection = new ChildRunParentTraceProjection({
      childEventBus: eventBus,
      parentTracePublisher: {
        publish: vi.fn(() => {
          throw projectionError;
        }),
      },
    });
    projection.connect();

    expect(() =>
      publisher.publish(
        createFinalAnswerEvent(
          'answer-1',
          'conversation-child-projection',
          'turn-child-1',
          '正文',
          { completion_reason: 'terminal' }
        ),
        'child:test'
      )
    ).not.toThrow();

    expect(observedChildFacts).toEqual(['answer-1']);
    await expect(projection.drain()).rejects.toBe(projectionError);
  });
});
