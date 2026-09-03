import { describe, expect, it } from 'vitest';

import { routeRuntimeEvent, RunIdSchema } from '../../../contracts';
import type { AuditEnvelope, RoutedRuntimeEvent } from '../../../contracts';
import type { runSupervisor, telemetry } from '../../../runtime-kernel';
import {
  assertRunInvariants,
  createCollectingAuditPort,
  createMockTelemetryPort,
  createRunSupervisorHarness,
  validateRunInvariants,
} from '../index';

type TelemetryEvent = telemetry.TelemetryEvent;
type RunOutcome = runSupervisor.RunOutcome;

function thoughtEvent(id: string, runId: string): RoutedRuntimeEvent {
  return routeRuntimeEvent(
    {
      type: 'thought',
      id,
      conversation_id: 'conv-test',
      turn_id: 'turn-test',
      timestamp: Date.now(),
      version: 1,
      content: id,
      is_complete: true,
    },
    {
      run_id: runId,
      lane: 'foreground',
      visibility: 'conversation',
    }
  );
}

function waitUserEvent(runId: string): RoutedRuntimeEvent {
  return routeRuntimeEvent(
    {
      type: 'requires_user_interaction',
      id: 'wait-event',
      conversation_id: 'conv-test',
      turn_id: 'turn-test',
      timestamp: Date.now(),
      version: 1,
      form: { prompt: '需要用户确认' },
      interaction_id: 'interaction-wait-event',
      run_id: runId,
      tool_call_id: 'tool-wait-event',
      checkpoint_revision: 1,
      resume_token: 'resume-wait-event',
      interaction_status: 'pending',
    },
    {
      run_id: runId,
      lane: 'foreground',
      visibility: 'conversation',
    }
  );
}

function llmEvent(runId: string, parentRunId?: string): TelemetryEvent {
  return {
    kind: 'llm_call',
    modelId: 'scripted-model',
    stream: true,
    durationMs: 12,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    scope: {
      conversationId: 'conv-test',
      runId,
      parentRunId,
      turnId: runId,
    },
  };
}

function modelSelectEnvelope(runId: string): AuditEnvelope {
  return {
    envelopeId: `env-${runId}`,
    runId: RunIdSchema.parse(runId),
    ts: Date.now(),
    actor: { kind: 'system' },
    action: 'model.select',
    decision: { outcome: 'recorded' },
  };
}

describe('run-harness primitives', () => {
  it('createRunSupervisorHarness 一行装配 supervisor、eventBus、audit、telemetry', async () => {
    const harness = createRunSupervisorHarness({
      now: () => 100,
      runIdFactory: () => 'run-default',
    });

    const handle = await harness.registerRun({ runId: 'run-1' });
    await handle.markRunning({ currentNode: 'llm' });
    await handle.markCompleted({ iterationsUsed: 2 });

    const runs = await harness.getRegisteredRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: 'run-1',
      status: 'completed',
      currentNode: 'llm',
      iterationsUsed: 2,
    });

    harness.restore();
  });

  it('CollectingAuditPort 支持 action 过滤与顺序断言', () => {
    const audit = createCollectingAuditPort();
    audit.port.emit(modelSelectEnvelope('run-1'));
    audit.port.emit({
      envelopeId: 'env-cancel',
      runId: RunIdSchema.parse('run-1'),
      ts: Date.now(),
      actor: { kind: 'host' },
      action: 'run.cancel',
      decision: { outcome: 'cancelled', reason: 'user_request' },
    });

    expect(audit.getEnvelopes('model.select')).toHaveLength(1);
    expect(audit.assertEmitted('run.cancel').decision?.reason).toBe('user_request');
    expect(audit.assertEmittedInOrder(['model.select', 'run.cancel'])).toHaveLength(2);
  });

  it('MockTelemetryPort 按 runId 分桶并聚合 childrenTotal', () => {
    const telemetry = createMockTelemetryPort();
    telemetry.emit(llmEvent('parent-run'));
    telemetry.emit(llmEvent('child-run-1', 'parent-run'));
    telemetry.emit(llmEvent('child-run-2', 'parent-run'));

    expect(telemetry.getTotalUsageByRun('child-run-1')).toMatchObject({
      tokensInput: 10,
      tokensOutput: 5,
      llmCallCount: 1,
    });
    expect(telemetry.costCollector.snapshot(RunIdSchema.parse('parent-run'))).toMatchObject({
      tokensInput: 10,
      tokensOutput: 5,
      childrenTotal: {
        tokensInput: 20,
        tokensOutput: 10,
      },
    });
  });

  it('validateRunInvariants 默认严格校验 run 生命周期与 telemetry/audit 关联', async () => {
    const harness = createRunSupervisorHarness();
    const handle = await harness.registerRun({
      runId: 'run-1',
      conversationId: 'conv-test',
    });
    await handle.markCompleted();
    harness.telemetry.emit(llmEvent('run-1'));
    harness.audit.port.emit(modelSelectEnvelope('run-1'));
    const event = thoughtEvent('thought-1', 'run-1');
    await harness.persist(event, '0000000000001-0000');

    const report = await validateRunInvariants({
      rootRunId: 'run-1',
      runRecords: await harness.getRegisteredRuns(),
      events: [event],
      persistedEvents: await harness.eventStore.range('conv-test'),
      telemetryEvents: harness.telemetry.getEvents(),
      auditEnvelopes: harness.audit.getEnvelopes(),
      signal: handle.signal,
      getCost: runId => harness.telemetry.costCollector.snapshot(RunIdSchema.parse(runId)),
    });

    expect(report.ok).toBe(true);
    assertRunInvariants(report);
    harness.restore();
  });

  it('validateRunInvariants 能校验 wait_user 状态联动', async () => {
    const harness = createRunSupervisorHarness();
    const handle = await harness.registerRun({
      runId: 'run-wait',
      conversationId: 'conv-test',
    });
    const event = waitUserEvent('run-wait');
    harness.publish(event);
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    const report = await validateRunInvariants(
      {
        rootRunId: 'run-wait',
        runRecords: await harness.getRegisteredRuns(),
        events: [event],
        signal: handle.signal,
      },
      {
        enabled: ['I13_WAIT_USER_STATUS'],
      }
    );

    expect(report.ok).toBe(true);
    harness.restore();
  });

  it('createRunSupervisorHarness 支持 detached spawn 与终态不变量', async () => {
    const outcomes: RunOutcome[] = [];
    const harness = createRunSupervisorHarness({
      runIdFactory: () => 'detached-test',
      executor: {
        async execute(context) {
          const outcome: RunOutcome = {
            runId: context.runId,
            status: 'completed',
            completedAt: Date.now(),
            currentNode: 'answer',
          };
          outcomes.push(outcome);
          return outcome;
        },
      },
    });

    const handle = await harness.spawnDetached({
      conversationId: 'conv-test',
    });
    const terminal = await harness.supervisor.waitForTerminal(handle.runId);
    const report = await validateRunInvariants(
      {
        rootRunId: handle.runId,
        runRecords: await harness.getRegisteredRuns(),
        terminalOutcomes: [terminal],
        inFlightRunIds: [],
        signal: handle.signal,
      },
      {
        enabled: ['I14_DETACHED_TERMINAL_OUTCOME', 'I15_DRAIN_NO_INFLIGHT'],
      }
    );

    expect(outcomes).toHaveLength(1);
    expect(report.ok).toBe(true);
    harness.restore();
  });
});
