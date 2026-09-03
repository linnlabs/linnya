import { describe, expect, it } from 'vitest';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { projectActiveForegroundRun } from './projectActiveForegroundRun';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';

type RunSnapshot = runSupervisor.RunSnapshot;

function createRun(overrides: Partial<RunSnapshot>): RunSnapshot {
  return {
    runId: RunIdSchema.parse('run-foreground'),
    conversationId: 'conversation-1',
    status: 'running',
    startedAt: 1,
    updatedAt: 1,
    metadata: {
      lane: 'foreground',
      turnId: 'turn-1',
      executionId: 'execution-1',
    },
    ...overrides,
  };
}

describe('projectActiveForegroundRun', () => {
  it('只投影唯一 foreground run，不把并行 auxiliary 标题当成正文', () => {
    const response = projectActiveForegroundRun('conversation-1', [
      createRun({
        runId: RunIdSchema.parse('run-title'),
        metadata: { lane: 'auxiliary', turnId: 'title-turn' },
      }),
      createRun({}),
    ]);

    expect(response.run).toEqual({
      run_id: 'run-foreground',
      turn_id: 'turn-1',
      execution_id: 'execution-1',
      status: 'running',
      lane: 'foreground',
      pending_interaction: undefined,
    });
  });

  it('awaiting_user 必须完整投影一次性 interaction 身份', () => {
    const response = projectActiveForegroundRun('conversation-1', [
      createRun({
        status: 'awaiting_user',
        metadata: {
          lane: 'foreground',
          turnId: 'turn-1',
          awaitingUser: {
            interaction: {
              interactionId: 'interaction-1',
              toolCallId: 'tool-call-1',
              checkpointRevision: 7,
              resumeToken: 'resume-1',
              status: 'pending',
            },
          },
        },
      }),
    ]);

    expect(response.run?.pending_interaction).toEqual({
      interaction_id: 'interaction-1',
      run_id: 'run-foreground',
      tool_call_id: 'tool-call-1',
      checkpoint_revision: 7,
      resume_token: 'resume-1',
    });
  });

  it('发现两个 active foreground run 时拒绝返回歧义控制权', () => {
    expect(() =>
      projectActiveForegroundRun('conversation-1', [
        createRun({ runId: RunIdSchema.parse('run-1') }),
        createRun({ runId: RunIdSchema.parse('run-2') }),
      ])
    ).toThrow('multiple active foreground runs');
  });
});
