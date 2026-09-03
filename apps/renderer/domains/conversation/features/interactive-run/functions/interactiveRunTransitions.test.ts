import { describe, expect, it } from 'vitest';
import type { SSEEvent } from 'linnkit/contracts';
import type { InteractiveRunSnapshot } from '../definitions/interactiveRun';
import { isInteractiveRunBusy, reduceInteractiveRunEvent } from './interactiveRunTransitions';
import { RunIdSchema, ToolCallIdSchema } from 'linnkit/contracts';

function waitEvent(conversationId: string, runId: string): SSEEvent {
  return {
    type: 'requires_user_interaction',
    id: `interaction-${conversationId}`,
    timestamp: 1,
    conversation_id: conversationId,
    turn_id: `turn-${conversationId}`,
    run_id: RunIdSchema.parse(runId),
    execution_id: `execution-${conversationId}`,
    lane: 'foreground',
    visibility: 'conversation',
    interaction_id: `interaction-${conversationId}`,
    tool_call_id: ToolCallIdSchema.parse(`tool-${conversationId}`),
    checkpoint_revision: 3,
    resume_token: `token-${conversationId}`,
    interaction_status: 'pending',
    form: { questions: [{ id: 'goal', prompt: 'What is the goal?' }] },
  };
}

describe('interactive run transitions', () => {
  it('keeps awaiting_user busy after the transport stream ends', () => {
    const awaiting = reduceInteractiveRunEvent(undefined, waitEvent('conversation-a', 'run-a'));
    const afterTransportEnd = reduceInteractiveRunEvent(awaiting, {
      type: 'transport_end',
      id: 'end-a',
      timestamp: 2,
      conversation_id: 'conversation-a',
      turn_id: 'turn-conversation-a',
      run_id: RunIdSchema.parse('run-a'),
      execution_id: 'execution-conversation-a',
      lane: 'foreground',
      visibility: 'conversation',
      reason: 'complete',
    });

    expect(afterTransportEnd).toEqual(awaiting);
    expect(isInteractiveRunBusy(afterTransportEnd)).toBe(true);
  });

  it('run_status 是业务终态的唯一实时来源，transport completion 不参与推断', () => {
    const running = reduceInteractiveRunEvent(undefined, {
      type: 'thought',
      id: 'thought-running',
      conversation_id: 'conv-running',
      turn_id: 'turn-running',
      run_id: RunIdSchema.parse('run-running'),
      execution_id: 'execution-running',
      lane: 'foreground',
      visibility: 'conversation',
      timestamp: 1,
      content: 'working',
      is_complete: true,
    });

    const afterEnd = reduceInteractiveRunEvent(running, {
      type: 'run_status',
      id: 'status-running',
      conversation_id: 'conv-running',
      turn_id: 'turn-running',
      run_id: RunIdSchema.parse('run-running'),
      execution_id: 'execution-running',
      lane: 'foreground',
      visibility: 'conversation',
      timestamp: 2,
      status: 'running',
    });

    expect(afterEnd?.status).toBe('running');
  });

  it('isolates concurrent conversations and ignores auxiliary title events', () => {
    const conversationA = reduceInteractiveRunEvent(
      undefined,
      waitEvent('conversation-a', 'run-a')
    );
    const conversationB = reduceInteractiveRunEvent(undefined, {
      type: 'thought',
      id: 'thought-b',
      timestamp: 1,
      conversation_id: 'conversation-b',
      turn_id: 'turn-b',
      run_id: RunIdSchema.parse('run-b'),
      execution_id: 'execution-b',
      lane: 'foreground',
      visibility: 'conversation',
      content: 'working',
      is_complete: false,
    });
    const titleEvent: SSEEvent = {
      type: 'final_answer',
      id: 'title-answer',
      timestamp: 2,
      conversation_id: 'conversation-a',
      turn_id: 'title-turn',
      run_id: RunIdSchema.parse('title-run'),
      execution_id: 'title-execution',
      lane: 'auxiliary',
      visibility: 'none',
      answer_id: 'title',
      content: 'Generated title',
      completion_reason: 'terminal',
    };

    expect(conversationA?.runId).toBe('run-a');
    expect(conversationB?.runId).toBe('run-b');
    expect(reduceInteractiveRunEvent(conversationA, titleEvent)).toBe(conversationA);
  });

  it('提交问卷后忽略旧 execution 的迟到事件，直到新 resume transport 接管', () => {
    const current: InteractiveRunSnapshot = {
      conversationId: 'conversation-a',
      runId: 'run-a',
      turnId: 'turn-a',
      executionId: 'execution-before-resume',
      status: 'submitting',
      pendingInteraction: {
        interactionId: 'interaction-a',
        runId: 'run-a',
        toolCallId: 'tool-a',
        checkpointRevision: 3,
        resumeToken: 'resume-a',
      },
    };

    const staleEnd: SSEEvent = {
      type: 'run_status',
      id: 'stale-status',
      timestamp: 2,
      conversation_id: 'conversation-a',
      turn_id: 'turn-a',
      run_id: RunIdSchema.parse('run-a'),
      execution_id: 'execution-before-resume',
      lane: 'foreground',
      visibility: 'conversation',
      status: 'awaiting_user',
    };
    expect(reduceInteractiveRunEvent(current, staleEnd)).toBe(current);

    const resumedEnd: SSEEvent = {
      ...staleEnd,
      id: 'resumed-status',
      execution_id: 'execution-after-resume',
      status: 'running',
    };
    expect(reduceInteractiveRunEvent(current, resumedEnd)).toMatchObject({
      runId: 'run-a',
      executionId: 'execution-after-resume',
      status: 'running',
    });
  });

  it('活跃 foreground run 忽略同 conversation 其它 run 的迟到事件', () => {
    const current: InteractiveRunSnapshot = {
      conversationId: 'conversation-a',
      runId: 'run-current',
      turnId: 'turn-current',
      executionId: 'execution-current',
      status: 'running',
    };
    const staleEnd: SSEEvent = {
      type: 'run_status',
      id: 'stale-status',
      timestamp: 2,
      conversation_id: 'conversation-a',
      turn_id: 'turn-stale',
      run_id: RunIdSchema.parse('run-stale'),
      execution_id: 'execution-stale',
      lane: 'foreground',
      visibility: 'conversation',
      status: 'completed',
    };

    expect(reduceInteractiveRunEvent(current, staleEnd)).toBe(current);
  });
});
