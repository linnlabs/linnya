import { describe, expect, it, vi } from 'vitest';

import type { AgentSpec, AuditEnvelope } from '../../../contracts';
import type { AuditPort } from '../../../ports';
import { EventBus } from '../../execution/event-bus';
import { MemoryEventStore } from '../../graph-engine/event-store/memoryEventStore';
import { MemoryRunRegistryStore } from '../memoryRunRegistryStore';
import { RunConcurrencyLimitExceededError } from '../runErrors';
import { DefaultRunSupervisor } from '../runSupervisor';
import { RunIdSchema } from '../../../contracts';

interface Latch {
  promise: Promise<void>;
  release(): void;
}

function createLatch(): Latch {
  let release = (): void => {
    throw new Error('latch was released before initialization');
  };
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

const agentSpec: AgentSpec = {
  id: 'detached-cancellation-agent',
  version: '1.0.0',
  capabilities: ['agent'],
  tools: [],
  contextPolicy: { profileId: 'agent' },
};

describe('detached cancellation settlement', () => {
  it('取消只触发 abort，waitForTerminal 和资源释放等待 executor 写入最终进度', async () => {
    const runId = 'detached-cancellation';
    const executionStarted = createLatch();
    const abortObserved = createLatch();
    const releaseSettlement = createLatch();
    const auditEnvelopes: AuditEnvelope[] = [];
    const auditPort: AuditPort = {
      emit: vi.fn((envelope: AuditEnvelope) => {
        auditEnvelopes.push(envelope);
      }),
    };
    const registryStore = new MemoryRunRegistryStore();
    const supervisor = new DefaultRunSupervisor({
      registryStore,
      auditPort,
      runIdFactory: () => RunIdSchema.parse(runId),
      maxActiveRuns: 1,
      executor: {
        execute: async context => {
          executionStarted.release();
          await new Promise<void>(resolve => {
            context.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          abortObserved.release();
          await releaseSettlement.promise;
          return {
            runId: context.runId,
            status: 'cancelled',
            completedAt: 50,
            currentNode: 'cancelled',
            iterationsUsed: 6,
            error: {
              errorCode: 'RUN_CANCELLED',
              message: 'executor observed abort',
              recoverable: false,
            },
          };
        },
      },
    });

    const handle = await supervisor.spawnDetached({
      conversationId: 'conversation-detached-cancellation',
      agentSpec,
      request: { query: 'run until cancelled' },
      eventBus: new EventBus('execution-detached-cancellation'),
      eventStore: new MemoryEventStore(),
      costCollector: {
        snapshot: () => ({ tokensInput: 0, tokensOutput: 0 }),
      },
    });
    await executionStarted.promise;

    let terminalResolved = false;
    const terminal = supervisor.waitForTerminal(handle.runId).then(outcome => {
      terminalResolved = true;
      return outcome;
    });
    await supervisor.cancel(handle.runId, {
      reason: 'user requested cancellation',
      forceCleanup: false,
    });
    await abortObserved.promise;
    await Promise.resolve();

    expect(terminalResolved).toBe(false);
    await expect(registryStore.load(RunIdSchema.parse(runId))).resolves.toMatchObject({
      status: 'cancelled',
      currentNode: 'detached',
      iterationsUsed: undefined,
      errorIfAny: {
        message: 'user requested cancellation',
      },
    });
    await expect(
      supervisor.registerRun({
        runId: RunIdSchema.parse('run-before-detached-settlement'),
        conversationId: 'conversation-detached-cancellation',
        agentSpec,
        request: { query: 'must remain blocked' },
        eventBus: new EventBus('execution-before-detached-settlement'),
        eventStore: new MemoryEventStore(),
        costCollector: {
          snapshot: () => ({ tokensInput: 0, tokensOutput: 0 }),
        },
      })
    ).rejects.toBeInstanceOf(RunConcurrencyLimitExceededError);

    releaseSettlement.release();

    await expect(terminal).resolves.toMatchObject({
      runId,
      status: 'cancelled',
      currentNode: 'cancelled',
      iterationsUsed: 6,
      error: {
        message: 'user requested cancellation',
      },
    });
    await expect(registryStore.load(RunIdSchema.parse(runId))).resolves.toMatchObject({
      status: 'cancelled',
      currentNode: 'cancelled',
      iterationsUsed: 6,
      errorIfAny: {
        message: 'user requested cancellation',
      },
    });
    expect(auditEnvelopes.filter(envelope => envelope.action === 'run.cancel')).toHaveLength(1);
    await expect(
      supervisor.cancel(RunIdSchema.parse(runId), { reason: 'late cancellation' })
    ).rejects.toMatchObject({
      name: 'RunNotFoundError',
    });
    const nextHandle = await supervisor.registerRun({
      runId: RunIdSchema.parse('run-after-detached-settlement'),
      conversationId: 'conversation-detached-cancellation',
      agentSpec,
      request: { query: 'slot is available again' },
      eventBus: new EventBus('execution-after-detached-settlement'),
      eventStore: new MemoryEventStore(),
      costCollector: {
        snapshot: () => ({ tokensInput: 0, tokensOutput: 0 }),
      },
    });
    await nextHandle.markCompleted();
  });
});
