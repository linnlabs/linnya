import { describe, expect, it } from 'vitest';
import {
  createFinalAnswerEvent,
  createFinalAnswerChunkEvent,
  createToolOutputEvent,
  routeRuntimeEvent,
  type FinalAnswerEvent,
  RunIdSchema,
} from '../../../contracts';
import { EventBus } from '../event-bus';
import { RuntimeEventPublisher } from '../runtimeEventPublisher';
import { EventSequencer } from '../sequencer';

describe('RuntimeEventPublisher', () => {
  it('同一份正式身份同时进入 journal payload 和 execution envelope', () => {
    const sequencer = new EventSequencer('conversation-publisher');
    const eventBus = new EventBus(sequencer.getExecutionId());
    const received: unknown[] = [];
    eventBus.on('event', envelope => received.push(envelope));
    const publisher = new RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse('run-foreground'),
      parent_run_id: RunIdSchema.parse('run-parent'),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const draft = createFinalAnswerEvent(
      'answer-segment',
      'conversation-publisher',
      'turn-publisher',
      'done',
      { completion_reason: 'terminal' }
    );

    const published = publisher.publish(draft, 'test:answer');

    expect(published).toMatchObject({
      run_id: 'run-foreground',
      parent_run_id: 'run-parent',
      lane: 'foreground',
      visibility: 'conversation',
    });
    expect(received).toEqual([
      expect.objectContaining({
        seq: 1,
        source: 'test:answer',
        payload: published,
      }),
    ]);
    expect(draft).not.toHaveProperty('run_id');
  });

  it('拒绝把不同 execution 的 sequencer 和 bus 接在一起', () => {
    const first = new EventSequencer('conversation-a');
    const second = new EventSequencer('conversation-b');

    expect(
      () =>
        new RuntimeEventPublisher(new EventBus(first.getExecutionId()), second, {
          run_id: RunIdSchema.parse('run-a'),
          lane: 'foreground',
          visibility: 'conversation',
        })
    ).toThrow('same execution');
  });

  it('共享 schema 与 publisher admission 都拒绝非规范 final_answer 身份', () => {
    const sequencer = new EventSequencer('conversation-identity-gate');
    const eventBus = new EventBus(sequencer.getExecutionId());
    const identity = {
      run_id: RunIdSchema.parse('run-identity-gate'),
      lane: 'foreground' as const,
      visibility: 'conversation' as const,
    };
    const publisher = new RuntimeEventPublisher(eventBus, sequencer, identity);
    const legacyShapedDraft: FinalAnswerEvent = {
      ...createFinalAnswerEvent(
        'answer-identity-gate',
        'conversation-identity-gate',
        'turn-identity-gate',
        'done',
        { completion_reason: 'terminal' }
      ),
      id: 'separate-final-event-id',
    };

    expect(() => publisher.route(legacyShapedDraft)).toThrow('final_answer identity mismatch');
    expect(() => routeRuntimeEvent(legacyShapedDraft, identity)).toThrow(
      'final_answer id must equal answer_id'
    );

    const collidingChunk = createFinalAnswerChunkEvent(
      'answer-identity-gate',
      'conversation-identity-gate',
      'turn-identity-gate',
      'answer-identity-gate',
      0,
      'done'
    );
    expect(() => publisher.route(collidingChunk)).toThrow('final_answer_chunk identity collision');
  });

  it('durable-first incoming fact 应先取得正式身份再发布，且不混入 agent 生成结果', () => {
    const sequencer = new EventSequencer('conversation-committed-input');
    const eventBus = new EventBus(sequencer.getExecutionId());
    const received: unknown[] = [];
    eventBus.on('event', envelope => received.push(envelope));
    const publisher = new RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse('run-resume'),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const incoming = createToolOutputEvent(
      'interaction-output',
      'conversation-committed-input',
      'turn-resume',
      'interactive_form',
      'tool-call-resume',
      { status: 'success', observation: '用户已提交', data: { submitted: true } }
    );

    const durableFact = publisher.route(incoming);
    const published = publisher.publishRouted(durableFact, 'FlowIncomingEvents.committed', {
      recordInGeneratedJournal: false,
    });

    expect(published).toBe(durableFact);
    expect(received).toEqual([
      expect.objectContaining({
        source: 'FlowIncomingEvents.committed',
        payload: durableFact,
      }),
    ]);
    expect(publisher.getGeneratedEvents()).toEqual([]);
  });
});
