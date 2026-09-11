import { describe, expect, it } from 'vitest';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { readForegroundRunSettlement } from './readForegroundRunSettlement';

const conversationId = 'conversation-settlement';
const runId = RunIdSchema.parse('run-settlement');

function createRun(
  status: runSupervisor.RunSnapshot['status'],
  options: {
    executionId?: string;
    interactionId?: string;
    errorIfAny?: runSupervisor.RunSnapshot['errorIfAny'];
  } = {}
): runSupervisor.RunSnapshot {
  const awaitingUser = options.interactionId
    ? {
        interaction: {
          interactionId: options.interactionId,
          toolCallId: 'tool-call-settlement',
          checkpointRevision: 2,
          resumeToken: 'resume-token-settlement',
          status: 'pending',
        },
      }
    : undefined;
  return {
    runId,
    conversationId,
    status,
    startedAt: 1,
    updatedAt: 2,
    errorIfAny: options.errorIfAny,
    metadata: {
      lane: 'foreground',
      turnId: 'turn-settlement',
      executionId: options.executionId,
      awaitingUser,
    },
  };
}

describe('readForegroundRunSettlement', () => {
  it('等待 execution finalize 后读取 durable terminal，而不是返回过早的 active 快照', async () => {
    let complete = (): void => undefined;
    const completion = new Promise<void>(resolve => {
      complete = resolve;
    });
    let currentRuns: readonly runSupervisor.RunSnapshot[] = [
      createRun('cancelled', { executionId: 'execution-before-teardown' }),
    ];
    let reads = 0;

    const settlement = readForegroundRunSettlement({
      conversationId,
      runId,
      supervisor: {
        findByConversation: async () => {
          reads += 1;
          return [...currentRuns];
        },
      },
      executionCompletions: { findPending: () => completion },
    });

    await Promise.resolve();
    expect(reads).toBe(1);
    currentRuns = [
      createRun('cancelled', {
        errorIfAny: {
          errorCode: 'RUN_CANCELLED',
          message: 'client_disconnected',
          recoverable: false,
        },
      }),
    ];
    complete();

    await expect(settlement).resolves.toEqual({
      conversation_id: conversationId,
      requested_run_id: runId,
      run: {
        run_id: runId,
        status: 'cancelled',
        lane: 'foreground',
        error: {
          error_code: 'RUN_CANCELLED',
          message: 'client_disconnected',
          recoverable: false,
        },
      },
    });
    expect(reads).toBe(2);
  });

  it('断连后仍在工作的 Backend 立即返回 running，不等待执行 completion', async () => {
    await expect(
      readForegroundRunSettlement({
        conversationId,
        runId,
        supervisor: {
          findByConversation: async () => [createRun('running', { executionId: 'live' })],
        },
        executionCompletions: { findPending: () => new Promise<void>(() => {}) },
      })
    ).resolves.toMatchObject({ run: { status: 'running', execution_id: 'live' } });
  });

  it('response command 未接纳时保留原 awaiting-user interaction', async () => {
    const originalAwaiting = createRun('awaiting_user', {
      executionId: 'execution-original',
      interactionId: 'interaction-original',
    });

    await expect(
      readForegroundRunSettlement({
        conversationId,
        runId,
        supervisor: { findByConversation: async () => [originalAwaiting] },
        executionCompletions: { findPending: () => undefined },
      })
    ).resolves.toMatchObject({
      run: {
        status: 'awaiting_user',
        execution_id: 'execution-original',
        pending_interaction: {
          interaction_id: 'interaction-original',
        },
      },
    });
  });

  it('同一 run 已开始新 execution 时返回新的 active identity', async () => {
    const resumed = createRun('running', { executionId: 'execution-resumed' });

    await expect(
      readForegroundRunSettlement({
        conversationId,
        runId,
        supervisor: { findByConversation: async () => [resumed] },
        executionCompletions: { findPending: () => undefined },
      })
    ).resolves.toMatchObject({
      run: {
        run_id: runId,
        status: 'running',
        execution_id: 'execution-resumed',
      },
    });
  });

  it('durable registry 中没有该 run 时返回 null', async () => {
    await expect(
      readForegroundRunSettlement({
        conversationId,
        runId,
        supervisor: { findByConversation: async () => [] },
        executionCompletions: { findPending: () => undefined },
      })
    ).resolves.toEqual({
      conversation_id: conversationId,
      requested_run_id: runId,
      run: null,
    });
  });
});
