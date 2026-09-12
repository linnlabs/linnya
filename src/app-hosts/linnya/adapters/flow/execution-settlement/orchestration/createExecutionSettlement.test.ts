import { describe, expect, it } from 'vitest';
import {
  createRequiresUserInteractionEvent,
  routeRuntimeEvent,
  type EventEnvelope,
  type RuntimeEvent,
  RunIdSchema,
  ToolCallIdSchema,
} from '@linnlabs/linnkit/contracts';
import { execution, graph, llm } from '@linnlabs/linnkit/runtime-kernel';
import type {
  ExecutionSettlementPorts,
  ExecutionSettlementRunHandle,
} from '../definitions/executionSettlement';
import { createRunFailureEvent } from '../functions/createRunFailureEvent';
import { createExecutionSettlement } from './createExecutionSettlement';
import { publishRunFailureFact } from './publishRunFailureFact';

const contextUsage = {
  basis: 'last_completed_llm_prompt' as const,
  budget_model_id: 'primary-model',
  used_tokens: 900,
  components: {
    system_prompt_tokens: 200,
    conversation_tokens: 600,
    tool_definition_tokens: 100,
  },
  component_attribution: 'normalized_local_estimate' as const,
  input_budget_tokens: 1_000,
  remaining_tokens: 100,
  output_limit_tokens: 200,
  source: 'local-estimate' as const,
  confidence: 'estimate' as const,
  measured_at: 1_100,
};

function createPublishedFailureFact(error: unknown): graph.RuntimeFailureFact {
  const published = routeRuntimeEvent(createRunFailureEvent({
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    error,
  }), {
    run_id: RunIdSchema.parse('run-1'),
    lane: 'foreground',
    visibility: 'conversation',
  });
  if (!graph.isRuntimeFailureFact(published)) {
    throw new Error('test failure fact must remain classified');
  }
  return published;
}

interface SettlementHarness {
  readonly orchestration: ReturnType<typeof createExecutionSettlement>;
  readonly published: RuntimeEvent[];
  readonly order: string[];
  readonly calls: {
    drain: number;
    awaiting: number;
    completed: number;
    failed: number;
    cancelled: number;
    clearCheckpoint: number;
    releaseResources: number;
  };
  readonly awaitingInputs: unknown[];
  readonly completedInputs: unknown[];
  readonly failedInputs: unknown[];
  readonly cancelledInputs: unknown[];
}

function createHarness(input?: {
  readonly drainFailure?: Error;
  readonly checkpointCleanupFailure?: Error;
  readonly previousIterations?: number;
}): SettlementHarness {
  const published: RuntimeEvent[] = [];
  const order: string[] = [];
  const awaitingInputs: unknown[] = [];
  const completedInputs: unknown[] = [];
  const failedInputs: unknown[] = [];
  const cancelledInputs: unknown[] = [];
  const calls = {
    drain: 0,
    awaiting: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    clearCheckpoint: 0,
    releaseResources: 0,
  };
  const runHandle: ExecutionSettlementRunHandle = {
    runId: RunIdSchema.parse('run-1'),
    markAwaitingUser: async params => {
      calls.awaiting += 1;
      awaitingInputs.push(params);
      order.push('mark-awaiting');
    },
    markCompleted: async params => {
      calls.completed += 1;
      completedInputs.push(params);
      order.push('mark-completed');
    },
    markFailed: async (_error, params) => {
      calls.failed += 1;
      failedInputs.push(params);
      order.push('mark-failed');
    },
    cancel: async (_opts, patch) => {
      calls.cancelled += 1;
      cancelledInputs.push(patch);
      order.push('cancel');
    },
  };
  const ports: ExecutionSettlementPorts = {
    publishRuntimeEvent: event => {
      published.push(event);
      order.push(`publish:${event.type}`);
      return routeRuntimeEvent(event, {
        run_id: RunIdSchema.parse('run-1'),
        lane: 'foreground',
        visibility: 'conversation',
      });
    },
    drainPersistence: async () => {
      calls.drain += 1;
      order.push('drain');
      if (input?.drainFailure) throw input.drainFailure;
    },
    runHandle,
    readRunIterationsUsed: async () => input?.previousIterations,
    clearCheckpoint: async () => {
      calls.clearCheckpoint += 1;
      order.push('clear-checkpoint');
      if (input?.checkpointCleanupFailure) throw input.checkpointCleanupFailure;
    },
    releaseRunResources: () => {
      calls.releaseResources += 1;
      order.push('release-resources');
    },
    now: () => 1120,
  };

  return {
    orchestration: createExecutionSettlement(
      {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        executionId: 'execution-1',
        executionStartedAtMs: 1000,
        userMessageId: 'user-message-1',
      },
      ports
    ),
    published,
    order,
    calls,
    awaitingInputs,
    completedInputs,
    failedInputs,
    cancelledInputs,
  };
}

describe('execution settlement orchestration', () => {
  it.each(['cancelled', 'failed'] as const)('恢复后的 %s 直接采用 durable 累计量，不重复相加，也不把未知 attempt 写成累计数', async kind => {
    const harness = createHarness({ previousIterations: 40 });
    await harness.orchestration.settleFailedExecution(kind === 'cancelled'
      ? { kind, runIterationsUsed: 47 }
      : { kind, runIterationsUsed: 47, failureFact: createPublishedFailureFact(new Error('Failure')) });
    expect(kind === 'cancelled' ? harness.cancelledInputs : harness.failedInputs)
      .toEqual([{ iterationsUsed: 47 }]);
    const metrics = harness.published.find(event => event.type === 'run_execution_metrics');
    expect(metrics?.metadata).toEqual({ run_iterations_used: 47 });
  });

  it('失败后无法读取 checkpoint 时保留未知口径，不伪造零步或覆盖 Registry 预算', async () => {
    const harness = createHarness({ previousIterations: 40 });
    await harness.orchestration.settleFailedExecution({ kind: 'cancelled' });
    expect(harness.cancelledInputs).toEqual([{}]);
    expect(harness.published.find(event => event.type === 'run_execution_metrics')?.metadata).toEqual({});
  });

  it('主 Prompt 容量拒绝通过标准 run failure 链发布 typed error fact', () => {
    const failureFact = createPublishedFailureFact(
      new graph.PrimaryPromptCapacityError({
        ...contextUsage,
        used_tokens: 1_001,
        components: {
          system_prompt_tokens: 200,
          conversation_tokens: 701,
          tool_definition_tokens: 100,
        },
        remaining_tokens: -1,
      }),
    );

    expect(failureFact).toMatchObject({
      type: 'error',
      error_code: graph.PRIMARY_PROMPT_CAPACITY_ERROR_CODE,
      retryable: false,
      details: expect.objectContaining({
        classification: expect.objectContaining({
          metadata: {
            modelId: 'primary-model',
            usedTokens: 1_001,
            inputBudgetTokens: 1_000,
            exceededByTokens: 1,
            source: 'local-estimate',
            confidence: 'estimate',
          },
        }),
      }),
    });
  });

  it('durable metrics drain 成功后才落 completed，再释放终态资源', async () => {
    const harness = createHarness();

    await harness.orchestration.settleSuccessfulExecution({
      checkpointNodeId: 'answer',
      stepCount: 4,
      contextUsage,
    });

    expect(harness.order).toEqual([
      'publish:run_execution_metrics',
      'drain',
      'clear-checkpoint',
      'mark-completed',
      'release-resources',
    ]);
    expect(harness.published[0]).toMatchObject({
      type: 'run_execution_metrics',
      execution_id: 'execution-1',
      outcome: 'completed',
      duration_ms: 120,
      user_message_id: 'user-message-1',
      context_usage: contextUsage,
      metadata: {
        execution_steps_used: 4,
        run_iterations_used: 4,
      },
    });
    expect(harness.completedInputs).toEqual([
      { currentNode: 'answer', iterationsUsed: 4 },
    ]);
  });

  it('resume execution 将当前步数累加到同一逻辑 run 的 iterationsUsed', async () => {
    const portsWithPrevious = {
      readRunIterationsUsed: async () => 6,
    } satisfies Pick<ExecutionSettlementPorts, 'readRunIterationsUsed'>;
    const orchestration = createExecutionSettlement(
      {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        executionId: 'execution-resume',
        executionStartedAtMs: 1000,
      },
      {
        publishRuntimeEvent: event => routeRuntimeEvent(event, {
          run_id: RunIdSchema.parse('run-1'),
          lane: 'foreground',
          visibility: 'conversation',
        }),
        drainPersistence: async () => undefined,
        runHandle: {
          runId: RunIdSchema.parse('run-1'),
          markAwaitingUser: async () => undefined,
          markCompleted: async params => {
            expect(params).toBeDefined();
            expect(params?.iterationsUsed).toBe(10);
          },
          markFailed: async () => undefined,
          cancel: async () => undefined,
        },
        ...portsWithPrevious,
        clearCheckpoint: async () => undefined,
        releaseRunResources: () => undefined,
        now: () => 1120,
      },
    );
    await orchestration.settleSuccessfulExecution({ checkpointNodeId: 'answer', stepCount: 4 });
  });

  it('wait-user 在 durable drain 后落 awaiting，并保留 checkpoint 与 run 资源供 resume', async () => {
    const harness = createHarness();
    const admittedWaitUserEvent = routeRuntimeEvent(
      createRequiresUserInteractionEvent('wait-user-1', 'conversation-1', 'turn-1', {
        prompt: '请确认内容',
        interaction_id: 'interaction-1',
        run_id: RunIdSchema.parse('run-1'),
        tool_call_id: ToolCallIdSchema.parse('tool-call-1'),
        checkpoint_revision: 3,
        resume_token: 'resume-token-1',
        interaction_status: 'pending',
      }),
      {
        run_id: RunIdSchema.parse('run-1'),
        lane: 'foreground',
        visibility: 'conversation',
      }
    );
    if (admittedWaitUserEvent.type !== 'requires_user_interaction') {
      throw new Error('wait-user fixture must preserve its event variant');
    }

    await harness.orchestration.settleSuccessfulExecution({
      checkpointNodeId: 'wait_user',
      stepCount: 2,
      waitUserEvent: admittedWaitUserEvent,
    });

    expect(harness.order).toEqual(['publish:run_execution_metrics', 'drain', 'mark-awaiting']);
    expect(harness.awaitingInputs).toEqual([
      expect.objectContaining({
        currentNode: 'wait_user',
        iterationsUsed: 2,
        eventId: 'wait-user-1',
        reason: '请确认内容',
        interaction: {
          interactionId: 'interaction-1',
          toolCallId: 'tool-call-1',
          checkpointRevision: 3,
          resumeToken: 'resume-token-1',
        },
      }),
    ]);
    expect(harness.calls.clearCheckpoint).toBe(0);
    expect(harness.calls.releaseResources).toBe(0);
  });

  it('wait-user 缺少正式 interaction 事实时，在发布 metrics 和 drain 前拒绝结算', async () => {
    const harness = createHarness();

    await expect(
      harness.orchestration.settleSuccessfulExecution({
        checkpointNodeId: 'wait_user',
        stepCount: 2,
      })
    ).rejects.toThrow('wait_user checkpoint requires a published interaction event');

    expect(harness.published).toEqual([]);
    expect(harness.calls.drain).toBe(0);
    expect(harness.calls.awaiting).toBe(0);
  });

  it('Graph 完成后 drain 失败时转 failed，不重复 metrics 或重试已失败 drain', async () => {
    const persistenceError = new Error('event transaction failed');
    const harness = createHarness({ drainFailure: persistenceError });

    await expect(
      harness.orchestration.settleSuccessfulExecution({
        checkpointNodeId: 'answer',
        stepCount: 4,
      })
    ).rejects.toBe(persistenceError);

    const failureFact = createPublishedFailureFact(persistenceError);
    await harness.orchestration.settleFailedExecution({
      kind: 'failed',
      stepCount: 4,
      failureFact,
    });

    expect(harness.published.map(event => event.type)).toEqual(['run_execution_metrics']);
    expect(harness.published[0]).toMatchObject({
      type: 'run_execution_metrics',
      outcome: 'completed',
    });
    expect(harness.calls.drain).toBe(1);
    expect(harness.calls.failed).toBe(1);
    expect(harness.failedInputs).toEqual([{ iterationsUsed: 4 }]);
    expect(harness.calls.completed).toBe(0);
    expect(harness.calls.clearCheckpoint).toBe(1);
    expect(harness.calls.releaseResources).toBe(1);
  });

  it('Graph 完成后 checkpoint 清理失败时，不先锁死 completed 终态，也不重试失败清理', async () => {
    const cleanupError = new Error('checkpoint database unavailable');
    const harness = createHarness({ checkpointCleanupFailure: cleanupError });

    await expect(
      harness.orchestration.settleSuccessfulExecution({
        checkpointNodeId: 'answer',
        stepCount: 4,
      })
    ).rejects.toBe(cleanupError);

    const failureFact = createPublishedFailureFact(cleanupError);
    await harness.orchestration.settleFailedExecution({
      kind: 'failed',
      stepCount: 4,
      failureFact,
    });

    expect(harness.order).toEqual([
      'publish:run_execution_metrics',
      'drain',
      'clear-checkpoint',
      'drain',
      'mark-failed',
      'release-resources',
    ]);
    expect(harness.published[0]).toMatchObject({
      type: 'run_execution_metrics',
      outcome: 'completed',
    });
    expect(harness.calls.completed).toBe(0);
    expect(harness.calls.failed).toBe(1);
    expect(harness.failedInputs).toEqual([{ iterationsUsed: 4 }]);
    expect(harness.calls.clearCheckpoint).toBe(1);
  });

  it('failed execution 将当前步数与 run 累计步数分别写入 metrics 和 failed patch', async () => {
    const harness = createHarness();
    const failureFact = createPublishedFailureFact(new Error('provider failed'));
    const orchestration = createExecutionSettlement(
      {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        executionId: 'execution-failed',
        executionStartedAtMs: 1000,
      },
      {
        publishRuntimeEvent: event => {
          harness.published.push(event);
          harness.order.push(`publish:${event.type}`);
          return routeRuntimeEvent(event, {
            run_id: RunIdSchema.parse('run-1'),
            lane: 'foreground',
            visibility: 'conversation',
          });
        },
        drainPersistence: async () => undefined,
        runHandle: {
          runId: RunIdSchema.parse('run-1'),
          markAwaitingUser: async () => undefined,
          markCompleted: async () => undefined,
          markFailed: async (_error, patch) => {
            expect(patch?.iterationsUsed).toBe(8);
          },
          cancel: async () => undefined,
        },
        readRunIterationsUsed: async () => 5,
        clearCheckpoint: async () => undefined,
        releaseRunResources: () => undefined,
        now: () => 1120,
      },
    );

    await orchestration.settleFailedExecution({
      kind: 'failed',
      stepCount: 3,
      failureFact,
    });

    expect(harness.published[0]).toMatchObject({
      type: 'run_execution_metrics',
      outcome: 'failed',
      metadata: {
        execution_steps_used: 3,
        run_iterations_used: 8,
      },
    });
  });

  it('cancelled execution 使用同一累计口径，并保留取消原因', async () => {
    const harness = createHarness();
    const orchestration = createExecutionSettlement(
      {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        executionId: 'execution-cancelled',
        executionStartedAtMs: 1000,
      },
      {
        publishRuntimeEvent: event => {
          harness.published.push(event);
          harness.order.push(`publish:${event.type}`);
          return routeRuntimeEvent(event, {
            run_id: RunIdSchema.parse('run-1'),
            lane: 'foreground',
            visibility: 'conversation',
          });
        },
        drainPersistence: async () => undefined,
        runHandle: {
          runId: RunIdSchema.parse('run-1'),
          markAwaitingUser: async () => undefined,
          markCompleted: async () => undefined,
          markFailed: async () => undefined,
          cancel: async (_opts, patch) => {
            expect(patch?.iterationsUsed).toBe(9);
          },
        },
        readRunIterationsUsed: async () => 7,
        clearCheckpoint: async () => undefined,
        releaseRunResources: () => undefined,
        now: () => 1120,
      },
    );

    await orchestration.settleFailedExecution({
      kind: 'cancelled',
      stepCount: 2,
      abortReason: 'user requested stop',
    });

    expect(harness.published[0]).toMatchObject({
      type: 'run_execution_metrics',
      outcome: 'cancelled',
      metadata: {
        execution_steps_used: 2,
        run_iterations_used: 9,
      },
    });
  });

  it('run 失败与 execution metrics 通过同一 publisher 获得同一 run 路由身份', async () => {
    const sequencer = new execution.EventSequencer('conversation-1');
    const eventBus = new execution.EventBus(sequencer.getExecutionId());
    const published: EventEnvelope<RuntimeEvent>[] = [];
    eventBus.on('event', envelope => {
      published.push(envelope);
    });
    const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse('run-1'),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const runHandle: ExecutionSettlementRunHandle = {
      runId: RunIdSchema.parse('run-1'),
      markAwaitingUser: async () => undefined,
      markCompleted: async () => undefined,
      markFailed: async () => undefined,
      cancel: async () => undefined,
    };
    const orchestration = createExecutionSettlement(
      {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        executionId: sequencer.getExecutionId(),
        executionStartedAtMs: 1000,
      },
      {
        publishRuntimeEvent: (event, source) => publisher.publish(event, source),
        drainPersistence: async () => undefined,
        runHandle,
        clearCheckpoint: async () => undefined,
        releaseRunResources: () => undefined,
        now: () => 1120,
      }
    );
    const failureFact = publishRunFailureFact({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      error: new llm.LlmImageInputError(
        llm.LLM_IMAGE_INPUT_ERROR_CODES.CONTEXT_BUDGET_EXCEEDED,
        'Image-protected context exceeds the active input budget.',
        {
          active_model_id: 'vision-model',
          placement: 'user_image',
          attachment_id: 'attachment-1',
          resource_id: 'asset-1',
          profile_id: 'vision-profile',
          limit_kind: 'context_tokens',
          actual_value: 105,
          limit_value: 100,
        }
      ),
    }, (event, source) => publisher.publish(event, source));

    await orchestration.settleFailedExecution({ kind: 'failed', stepCount: 0, failureFact });

    expect(published.map(envelope => envelope.payload)).toEqual([
      expect.objectContaining({
        type: 'error',
        error_code: 'llm.image_input.context_budget_exceeded',
        retryable: false,
        run_id: 'run-1',
        lane: 'foreground',
        visibility: 'conversation',
      }),
      expect.objectContaining({
        type: 'run_execution_metrics',
        outcome: 'failed',
        run_id: 'run-1',
        lane: 'foreground',
        visibility: 'conversation',
      }),
    ]);
  });
});
