import { describe, expect, it } from 'vitest';
import { projectActiveRunResponse } from './projectActiveRunResponse';

describe('projectActiveRunResponse', () => {
  it('把 reload 查询到的 awaiting run 恢复为同一个可提交 interaction', () => {
    expect(projectActiveRunResponse({
      conversation_id: 'conversation-1',
      run: {
        run_id: 'run-1',
        turn_id: 'turn-1',
        execution_id: 'execution-1',
        status: 'awaiting_user',
        lane: 'foreground',
        pending_interaction: {
          interaction_id: 'interaction-1',
          run_id: 'run-1',
          tool_call_id: 'tool-call-1',
          checkpoint_revision: 5,
          resume_token: 'resume-1',
        },
      },
    })).toEqual({
      conversationId: 'conversation-1',
      runId: 'run-1',
      turnId: 'turn-1',
      executionId: 'execution-1',
      status: 'awaiting_user',
      pendingInteraction: {
        interactionId: 'interaction-1',
        runId: 'run-1',
        toolCallId: 'tool-call-1',
        checkpointRevision: 5,
        resumeToken: 'resume-1',
      },
    });
  });

  it('没有 active foreground run 时清空控制快照', () => {
    expect(projectActiveRunResponse({
      conversation_id: 'conversation-1',
      run: null,
    })).toBeUndefined();
  });
});
