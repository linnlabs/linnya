import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { SSEEvent } from '@linnlabs/linnkit/contracts';
import { useInteractiveRunStore } from './interactiveRunStore';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

function createAwaitingEvent(): Extract<SSEEvent, { type: 'requires_user_interaction' }> {
  return {
    type: 'requires_user_interaction',
    id: 'interaction-1',
    timestamp: 1,
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    run_id: RunIdSchema.parse('run-1'),
    execution_id: 'execution-1',
    lane: 'foreground',
    visibility: 'conversation',
    interaction_id: 'interaction-1',
    tool_call_id: ToolCallIdSchema.parse('ask-ppt-requirements'),
    checkpoint_revision: 3,
    resume_token: 'resume-1',
    interaction_status: 'pending',
    form: { questions: [{ id: 'goal', prompt: 'PPT 的目标是什么？' }] },
  };
}

describe('interactive run store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('已有 foreground run 忙碌时拒绝新 start，且不得中止原 transport', () => {
    const store = useInteractiveRunStore();
    const originalController = new AbortController();
    store.beginStart('conversation-1', originalController);

    expect(() => store.beginStart('conversation-1', new AbortController())).toThrow(
      'already has active foreground run'
    );
    expect(originalController.signal.aborted).toBe(false);
    expect(store.snapshotFor('conversation-1')?.status).toBe('starting');
  });

  it('进入 awaiting_user 后 transport 结束只释放请求控制器，不结束逻辑 run', () => {
    const store = useInteractiveRunStore();
    const controller = new AbortController();
    store.beginStart('conversation-1', controller);
    store.observeEvent(createAwaitingEvent());
    store.observeEvent({
      type: 'transport_end',
      id: 'transport-end-1',
      timestamp: 2,
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      run_id: RunIdSchema.parse('run-1'),
      execution_id: 'execution-1',
      lane: 'foreground',
      visibility: 'conversation',
      reason: 'complete',
    });

    store.abortTransport('conversation-1');

    expect(controller.signal.aborted).toBe(false);
    expect(store.snapshotFor('conversation-1')).toMatchObject({
      runId: 'run-1',
      status: 'awaiting_user',
      pendingInteraction: { interactionId: 'interaction-1' },
    });
  });

  it('问卷提交后旧 execution 的 transport_end 不得释放新的 resume controller', () => {
    const store = useInteractiveRunStore();
    store.beginStart('conversation-1', new AbortController());
    store.observeEvent(createAwaitingEvent());

    const resumeController = new AbortController();
    store.beginSubmitting('conversation-1', resumeController);
    store.observeEvent({
      type: 'transport_end',
      id: 'transport-end-before-resume',
      timestamp: 2,
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      run_id: RunIdSchema.parse('run-1'),
      execution_id: 'execution-1',
      lane: 'foreground',
      visibility: 'conversation',
      reason: 'complete',
    });

    expect(store.snapshotFor('conversation-1')?.status).toBe('submitting');
    store.abortTransport('conversation-1');
    expect(resumeController.signal.aborted).toBe(true);
  });

  it('transport outcome 只能释放自己请求的 controller，不能释放后继请求 owner', () => {
    const store = useInteractiveRunStore();
    const originalController = new AbortController();
    store.beginStart('conversation-1', originalController);
    store.observeEvent(createAwaitingEvent());

    const resumeController = new AbortController();
    store.beginSubmitting('conversation-1', resumeController);

    expect(store.releaseTransport('conversation-1', originalController)).toBe(false);
    expect(store.releaseTransport('conversation-1', resumeController)).toBe(true);
    store.abortTransport('conversation-1');
    expect(resumeController.signal.aborted).toBe(false);
  });
});
